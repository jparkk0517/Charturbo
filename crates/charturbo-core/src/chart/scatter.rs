//! Scatter / bubble chart: nice-domain layout, instanced px-sized points, x + y zoom window,
//! uniform-grid spatial hash for O(1) nearest-point hover, axes and gridlines.

use super::line::DIMMED_SERIES_ALPHA;
use super::scale::{log_nice_domain, AxisScale};
use super::finite::{max_f64, min_f64};
use super::*;
use crate::renderer::{ChartPointRaw, ChartPointStyleRaw, MAX_POINT_SERIES, POINT_SHAPE_STRIDE};

/// Point fill when neither per-point nor series colors are given.
const DEFAULT_POINT_COLOR: [f32; 4] = [0.224, 0.529, 0.898, 1.0];
/// Smallest zoom window per axis, as a fraction of the nice domain.
const MIN_WINDOW_SPAN: f32 = 1.0 / 4096.0;
/// Target average number of points per spatial-hash cell.
const POINTS_PER_CELL: usize = 2;
/// Spatial-hash resolution limit per axis (2048^2 cells at ~8M points).
const MAX_GRID_CELLS: usize = 2048;

/// Scatter input. Optional channels are either empty or one entry per point.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ScatterPoints {
    pub xs: Vec<f32>,
    pub ys: Vec<f32>,
    /// Per-point radius in CSS px (bubbles); empty = `ScatterLayout::radius_px`
    pub sizes: Vec<f32>,
    /// Per-point series id; empty = every point in series 0
    pub series: Vec<u16>,
    /// Per-point RGBA; empty = the color of the point's series
    pub colors: Vec<[f32; 4]>,
    /// Color of each series id (wraps around when shorter than the id range)
    pub series_colors: Vec<[f32; 4]>,
}

/// Ripple (ECharts `effectScatter`) of flagged series: rings grow from the point to `scale`
/// times its radius and fade out over `period_s`, `count` rings evenly phase-shifted, stroked
/// (1.5 px) or filled at half strength.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RippleOptions {
    pub period_s: f32,
    pub scale: f32,
    pub count: u32,
    pub fill: bool,
}

impl Default for RippleOptions {
    fn default() -> Self {
        Self { period_s: 4.0, scale: 2.5, count: 3, fill: false }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ScatterLayout {
    pub width: f32,
    pub height: f32,
    /// Default point radius in CSS px
    pub radius_px: f32,
    /// Fill alpha multiplier (lower = overlap reads as density)
    pub opacity: f32,
    /// Separating ring width in CSS px, drawn in the hover ring color (chart surface); 0 = none
    pub ring_px: f32,
    /// Vertical gridlines at the x ticks (horizontal ones follow `ChartFrameStyle`)
    pub grid_x: bool,
}

impl Default for ScatterLayout {
    fn default() -> Self {
        Self {
            width: 160.0,
            height: 90.0,
            radius_px: 3.0,
            opacity: 0.85,
            ring_px: 0.0,
            grid_x: true,
        }
    }
}

/// Uniform grid over normalized data space in CSR layout: cell `c` (row-major, `cells` per
/// axis) owns `items[start[c]..start[c + 1]]`. Built once; zoom / pan only change the query.
#[derive(Debug, Clone, Default)]
pub(crate) struct PointGrid {
    cells: usize,
    start: Vec<u32>,
    items: Vec<u32>,
}

impl PointGrid {
    fn build(t: &[[f32; 2]]) -> Self {
        let finite = t.iter().filter(|p| p[0].is_finite()).count();
        let cells = ((finite / POINTS_PER_CELL).max(1) as f64).sqrt().ceil() as usize;
        let mut grid = Self {
            cells: cells.clamp(1, MAX_GRID_CELLS),
            start: Vec::new(),
            items: Vec::new(),
        };
        // Counting sort by cell: counts, prefix sums, then scatter the ids
        let mut start = vec![0u32; grid.cells * grid.cells + 1];
        for p in t.iter().filter(|p| p[0].is_finite()) {
            start[grid.cell_of(*p) + 1] += 1;
        }
        for c in 1..start.len() {
            start[c] += start[c - 1];
        }
        let mut cursor = start.clone();
        let mut items = vec![0u32; finite];
        for (i, p) in t.iter().enumerate().filter(|(_, p)| p[0].is_finite()) {
            let c = grid.cell_of(*p);
            items[cursor[c] as usize] = i as u32;
            cursor[c] += 1;
        }
        grid.start = start;
        grid.items = items;
        grid
    }

    #[inline]
    fn coord(&self, v: f32) -> usize {
        ((v * self.cells as f32).floor().max(0.0) as usize).min(self.cells - 1)
    }

    #[inline]
    fn cell_of(&self, p: [f32; 2]) -> usize {
        self.coord(p[1]) * self.cells + self.coord(p[0])
    }

    /// Calls `f` for every point id in the cells overlapping `[lo, hi]` (normalized space).
    fn for_each_in(&self, lo: [f32; 2], hi: [f32; 2], mut f: impl FnMut(usize)) {
        if self.items.is_empty() || hi[0] < 0.0 || hi[1] < 0.0 || lo[0] > 1.0 || lo[1] > 1.0 {
            return;
        }
        let (x0, x1) = (self.coord(lo[0]), self.coord(hi[0]));
        let (y0, y1) = (self.coord(lo[1]), self.coord(hi[1]));
        for cy in y0..=y1 {
            let row = cy * self.cells;
            let (from, to) = (self.start[row + x0] as usize, self.start[row + x1 + 1] as usize);
            // A row of cells is contiguous in CSR order
            for &i in &self.items[from..to] {
                f(i as usize);
            }
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct ScatterChart {
    pub(crate) ys: Vec<f32>,
    /// Input x (kept so a scale change can re-normalize the points)
    xs: Vec<f32>,
    /// Position in the nice domain, normalized to `[0, 1]` per axis (NaN = not drawn)
    pub(crate) t: Vec<[f32; 2]>,
    sizes: Vec<f32>,
    series: Vec<u16>,
    /// Resolved RGBA8 fill of every point
    colors: Vec<[u8; 4]>,
    pub(crate) layout: ScatterLayout,
    /// Nice domains in scale space (log10 units on a log axis)
    pub(crate) x_domain: (f64, f64),
    pub(crate) y_domain: (f64, f64),
    pub(crate) x_scale: AxisScale,
    pub(crate) y_scale: AxisScale,
    /// Visible part of the domain per axis, normalized; `(0, 1)` = everything
    pub(crate) window_x: (f32, f32),
    pub(crate) window_y: (f32, f32),
    /// Per series id
    pub(crate) visible: Vec<bool>,
    /// Emphasis / visibility are per-series alphas in the point uniform (no re-pack); false
    /// beyond `MAX_POINT_SERIES` series, where they are baked into the packed points instead
    series_in_uniform: bool,
    pub(crate) emphasis: Option<usize>,
    /// Shape code per series id (0 circle, 1 square, 2 diamond, 3 triangle; missing = circle)
    shapes: Vec<u8>,
    /// Jitter amplitude per axis in data units (scale space on log axes) and its seed
    jitter: [f64; 2],
    jitter_seed: u32,
    /// Rippling series ids, the ripple and its clock (seconds)
    ripple: Vec<bool>,
    ripple_opts: RippleOptions,
    effect_time_s: f32,
    grid: PointGrid,
    max_radius_px: f32,
    /// x tick target for the current plot width (about one tick per 90 CSS px)
    x_tick_target: u32,
}

/// PCG hash of a u32 (Jarzynski & Olano 2020, "Hash Functions for GPU Rendering").
fn pcg_hash(v: u32) -> u32 {
    let state = v.wrapping_mul(747_796_405).wrapping_add(2_891_336_453);
    let word = ((state >> ((state >> 28) + 4)) ^ state).wrapping_mul(277_803_737);
    (word >> 22) ^ word
}

/// Deterministic uniform value in [-1, 1) for point `i`, axis `axis`, `seed`.
fn jitter_unit(i: usize, axis: u32, seed: u32) -> f64 {
    let h = pcg_hash((i as u32).wrapping_mul(2).wrapping_add(axis) ^ pcg_hash(seed));
    h as f64 / 2_147_483_648.0 - 1.0
}

fn to_rgba8(c: [f32; 4]) -> [u8; 4] {
    c.map(|v| (v.clamp(0.0, 1.0) * 255.0).round() as u8)
}

impl ScatterChart {
    pub(crate) fn new(points: ScatterPoints, layout: ScatterLayout) -> Self {
        let ScatterPoints { xs, ys, sizes, series, colors, series_colors } = points;
        let n = xs.len().min(ys.len());

        let series = if series.len() == n { series } else { Vec::new() };
        let series_count = series.iter().map(|&s| s as usize + 1).max().unwrap_or(usize::from(n > 0));
        let series_rgba: Vec<[u8; 4]> = if series_colors.is_empty() {
            vec![to_rgba8(DEFAULT_POINT_COLOR)]
        } else {
            series_colors.iter().map(|&c| to_rgba8(c)).collect()
        };
        let colors = if colors.len() == n {
            colors.iter().map(|&c| to_rgba8(c)).collect()
        } else {
            (0..n)
                .map(|i| series_rgba[series.get(i).copied().unwrap_or(0) as usize % series_rgba.len()])
                .collect()
        };
        let sizes: Vec<f32> = if sizes.len() == n {
            sizes.iter().map(|&r| if r.is_finite() { r.clamp(0.0, 512.0) } else { layout.radius_px }).collect()
        } else {
            Vec::new()
        };
        let max_radius_px = sizes.iter().copied().fold(layout.radius_px, f32::max);

        let (mut xs, mut ys) = (xs, ys);
        xs.truncate(n);
        ys.truncate(n);
        let mut chart = Self {
            ys,
            xs,
            t: Vec::new(),
            sizes,
            series,
            colors,
            layout,
            x_domain: (0.0, 1.0),
            y_domain: (0.0, 1.0),
            x_scale: AxisScale::LINEAR,
            y_scale: AxisScale::LINEAR,
            window_x: (0.0, 1.0),
            window_y: (0.0, 1.0),
            visible: vec![true; series_count],
            series_in_uniform: series_count <= MAX_POINT_SERIES,
            emphasis: None,
            shapes: Vec::new(),
            jitter: [0.0; 2],
            jitter_seed: 0,
            ripple: Vec::new(),
            ripple_opts: RippleOptions::default(),
            effect_time_s: 0.0,
            grid: PointGrid::default(),
            max_radius_px,
            x_tick_target: 5,
        };
        chart.layout_points();
        chart
    }

    /// Nice domains of both axes in their scale space, normalized point positions, and the hover
    /// grid (O(points); on new data and scale changes). Points without a value on an axis' scale
    /// (non-finite; non-positive on a log axis) are not drawn.
    fn layout_points(&mut self) {
        let (sx, sy) = (self.x_scale, self.y_scale);
        let (xs, ys) = (&self.xs, &self.ys);
        let ([jx, jy], seed) = (self.jitter, self.jitter_seed);
        // Jitter (ggplot2 geom_jitter): uniform offsets in [-amplitude, amplitude], fixed per point
        let u = |i: usize| {
            let mut p = (sx.fwd(xs[i] as f64), sy.fwd(ys[i] as f64));
            if jx > 0.0 {
                p.0 += jx * jitter_unit(i, 0, seed);
            }
            if jy > 0.0 {
                p.1 += jy * jitter_unit(i, 1, seed);
            }
            (p.0.is_finite() && p.1.is_finite()).then_some(p)
        };
        let (mut x_lo, mut x_hi, mut y_lo, mut y_hi) = (f64::INFINITY, f64::NEG_INFINITY, f64::INFINITY, f64::NEG_INFINITY);
        for (x, y) in (0..xs.len()).filter_map(u) {
            // Finite (filtered by `u`): plain compares (chart/finite.rs)
            x_lo = min_f64(x_lo, x);
            x_hi = max_f64(x_hi, x);
            y_lo = min_f64(y_lo, y);
            y_hi = max_f64(y_hi, y);
        }
        if !x_lo.is_finite() {
            (x_lo, x_hi, y_lo, y_hi) = (0.0, 1.0, 0.0, 1.0);
        }
        let target = ChartFrameStyle::default().grid_rows;
        let domain = |lo: f64, hi: f64, scale: AxisScale| {
            if scale.is_log() {
                let (a, b) = log_nice_domain(scale.inv(lo), scale.inv(hi));
                (a.log10(), b.log10())
            } else {
                let (a, b, _) = nice_domain(lo, hi, scale.target(target));
                (a, b)
            }
        };
        let (dx0, dx1) = domain(x_lo, x_hi, sx);
        let (dy0, dy1) = domain(y_lo, y_hi, sy);

        // Normalize in f64 so large offsets (timestamps) keep their precision
        let t: Vec<[f32; 2]> = (0..xs.len())
            .map(|i| match u(i) {
                Some((x, y)) => [((x - dx0) / (dx1 - dx0)) as f32, ((y - dy0) / (dy1 - dy0)) as f32],
                None => [f32::NAN; 2],
            })
            .collect();
        self.grid = PointGrid::build(&t);
        self.t = t;
        self.x_domain = (dx0, dx1);
        self.y_domain = (dy0, dy1);
    }

    /// Sets the scale of x (`axis` 0) or y (1): re-normalizes every point and resets the zoom
    /// window. True when it changed.
    pub(crate) fn set_scale(&mut self, axis: u8, scale: AxisScale) -> bool {
        let slot = if axis == 0 { &mut self.x_scale } else { &mut self.y_scale };
        if *slot == scale {
            return false;
        }
        *slot = scale;
        self.layout_points();
        self.set_window((0.0, 1.0), (0.0, 1.0));
        true
    }

    pub(crate) fn len(&self) -> usize {
        self.t.len()
    }

    pub(crate) fn series_of(&self, i: usize) -> usize {
        self.series.get(i).copied().unwrap_or(0) as usize
    }

    /// Sets the shape of each series id (unknown codes = circle). True when it changed.
    pub(crate) fn set_shapes(&mut self, shapes: &[u8]) -> bool {
        let shapes: Vec<u8> = shapes.iter().map(|&c| if c <= 3 { c } else { 0 }).collect();
        let changed = shapes != self.shapes;
        self.shapes = shapes;
        changed
    }

    /// Sets the rippling series ids (`flags[id] != 0`) and the ripple (clamped: period >= 0.1 s,
    /// scale 1..10, 1..8 rings). True when the points or the uniform changed.
    pub(crate) fn set_ripple(&mut self, flags: &[u8], opts: RippleOptions) -> bool {
        let ripple: Vec<bool> = flags.iter().map(|&f| f != 0).collect();
        let clean = |v: f32, d: f32| if v.is_finite() { v } else { d };
        let d = RippleOptions::default();
        let opts = RippleOptions {
            period_s: clean(opts.period_s, d.period_s).max(0.1),
            scale: clean(opts.scale, d.scale).clamp(1.0, 10.0),
            count: opts.count.clamp(1, 8),
            fill: opts.fill,
        };
        let changed = ripple != self.ripple || opts != self.ripple_opts;
        self.ripple = ripple;
        self.ripple_opts = opts;
        changed
    }

    /// Sets the jitter amplitude per axis (data units; scale space on log axes; <= 0 = none) and
    /// its seed, re-laying out the points. True when it changed.
    pub(crate) fn set_jitter(&mut self, x: f64, y: f64, seed: u32) -> bool {
        let clean = |v: f64| if v.is_finite() { v.max(0.0) } else { 0.0 };
        let jitter = [clean(x), clean(y)];
        if jitter == self.jitter && seed == self.jitter_seed {
            return false;
        }
        (self.jitter, self.jitter_seed) = (jitter, seed);
        self.layout_points();
        true
    }

    /// Some series ripples (the SDK keeps a frame clock running).
    pub(crate) fn rippling(&self) -> bool {
        self.ripple.iter().any(|&r| r)
    }

    /// Point slot channel: the series slot plus the series' shape and ripple flag (see
    /// `POINT_SHAPE_STRIDE`).
    #[inline]
    fn packed_slot(&self, slot: f32, series: usize) -> f32 {
        let shape = self.shapes.get(series).copied().unwrap_or(0) as f32;
        let ripple = if self.ripple.get(series).copied().unwrap_or(false) { 4.0 } else { 0.0 };
        slot + POINT_SHAPE_STRIDE * (shape + ripple)
    }

    #[inline]
    fn radius(&self, i: usize) -> f32 {
        self.sizes.get(i).copied().unwrap_or(self.layout.radius_px)
    }

    /// `[sx, sy, tx, ty]` mapping base world xy (full domain) to world xy under the zoom window.
    pub(crate) fn transform(&self) -> [f32; 4] {
        let (w, h) = (self.layout.width, self.layout.height);
        let sx = 1.0 / (self.window_x.1 - self.window_x.0).max(1e-9);
        let sy = 1.0 / (self.window_y.1 - self.window_y.0).max(1e-9);
        // Reversed axes mirror the whole mapping
        let (fx, fy) = (self.x_scale.sign(), self.y_scale.sign());
        [
            sx * fx,
            sy * fy,
            w * ((0.5 - self.window_x.0) * sx - 0.5) * fx,
            h * ((0.5 - self.window_y.0) * sy - 0.5) * fy,
        ]
    }

    /// True when legend emphasis / visibility only change the point uniform.
    pub(crate) fn series_in_uniform(&self) -> bool {
        self.series_in_uniform
    }

    pub(crate) fn point_style(&self, hover: &ChartHoverStyle) -> ChartPointStyleRaw {
        let mut style = ChartPointStyleRaw {
            transform: self.transform(),
            ring_color: hover.marker_ring_color,
            params: [self.layout.ring_px.max(0.0), -1.0, self.effect_time_s, 0.0],
            effect: {
                let o = self.ripple_opts;
                [o.period_s, o.scale, o.count as f32, if o.fill { 1.0 } else { 0.0 }]
            },
            ..Default::default()
        };
        if self.series_in_uniform {
            for (s, &visible) in self.visible.iter().enumerate() {
                let alpha = match self.emphasis {
                    _ if !visible => 0.0,
                    Some(e) if e != s => DIMMED_SERIES_ALPHA,
                    _ => 1.0,
                };
                style.series_alpha[s / 4][s % 4] = alpha;
            }
            if let Some(e) = self.emphasis {
                style.params[1] = e as f32;
            }
        }
        style
    }

    /// World xy of a normalized position under the zoom window.
    #[inline]
    fn world_of_t(&self, t: [f32; 2]) -> (f32, f32) {
        let (wx, wy) = (self.window_x, self.window_y);
        (
            ((t[0] - wx.0) / (wx.1 - wx.0).max(1e-9) - 0.5) * self.layout.width * self.x_scale.sign(),
            ((t[1] - wy.0) / (wy.1 - wy.0).max(1e-9) - 0.5) * self.layout.height * self.y_scale.sign(),
        )
    }

    /// Normalized position of a world point under the zoom window.
    pub(crate) fn t_of_world(&self, x: f32, y: f32) -> [f32; 2] {
        let (wx, wy) = (self.window_x, self.window_y);
        [
            wx.0 + (x * self.x_scale.sign() / self.layout.width + 0.5) * (wx.1 - wx.0),
            wy.0 + (y * self.y_scale.sign() / self.layout.height + 0.5) * (wy.1 - wy.0),
        ]
    }

    pub(crate) fn point(&self, i: usize) -> Vec3 {
        let (x, y) = self.world_of_t(self.t[i]);
        Vec3::new(x, y, 0.0)
    }

    /// Visible data range of one axis (`domain` mapped through `window`).
    fn visible_range(domain: (f64, f64), window: (f32, f32)) -> (f64, f64) {
        let span = domain.1 - domain.0;
        (domain.0 + window.0 as f64 * span, domain.0 + window.1 as f64 * span)
    }

    /// World x of data `v` (through the x scale).
    fn world_x_of(&self, v: f64) -> f32 {
        let t = ((self.x_scale.fwd(v) - self.x_domain.0) / (self.x_domain.1 - self.x_domain.0)) as f32;
        self.world_of_t([t, 0.0]).0
    }

    fn world_y_of(&self, v: f64) -> f32 {
        let t = ((self.y_scale.fwd(v) - self.y_domain.0) / (self.y_domain.1 - self.y_domain.0)) as f32;
        self.world_of_t([0.0, t]).1
    }

    /// Visible x / y tick values (data units) for the visible window of each axis' scale.
    fn ticks(&self, rows: u32) -> (Vec<f64>, Vec<f64>) {
        let (x0, x1) = Self::visible_range(self.x_domain, self.window_x);
        let (y0, y1) = Self::visible_range(self.y_domain, self.window_y);
        let (tx, ty) = (self.x_scale.target(self.x_tick_target), self.y_scale.target(rows));
        (
            self.x_scale.ticks(x0, x1, nice_step(x1 - x0, tx), tx),
            self.y_scale.ticks(y0, y1, nice_step(y1 - y0, ty), ty),
        )
    }

    pub(crate) fn set_window(&mut self, x: (f32, f32), y: (f32, f32)) {
        let clamp = |(a, b): (f32, f32)| {
            let span = (b - a).clamp(MIN_WINDOW_SPAN, 1.0);
            let start = a.clamp(0.0, 1.0 - span);
            (start, start + span)
        };
        self.window_x = clamp(x);
        self.window_y = clamp(y);
    }

    /// Zooms both axes by `factor` (< 1 = in) keeping the data under `anchor` fixed.
    pub(crate) fn zoom(&mut self, factor: f32, anchor: [f32; 2]) {
        let zoom_axis = |(w0, w1): (f32, f32), a: f32| {
            let span = w1 - w0;
            let new_span = (span * factor).clamp(MIN_WINDOW_SPAN, 1.0);
            let a = a.clamp(w0, w1);
            let start = a - (a - w0) * (new_span / span.max(1e-9));
            (start, start + new_span)
        };
        let x = zoom_axis(self.window_x, anchor[0]);
        let y = zoom_axis(self.window_y, anchor[1]);
        self.set_window(x, y);
    }

    /// Updates the x tick target from the plot width; true when it changed.
    pub(crate) fn sync_view(&mut self, view: &ChartView) -> bool {
        let (hw, hh) = (self.layout.width * 0.5, self.layout.height * 0.5);
        let Some(plot) = plot_rect_css(view, hw, -hh, hh, 0.0) else {
            return false;
        };
        let target = ((plot[2] / 90.0).floor() as u32).max(2);
        let changed = target != self.x_tick_target;
        self.x_tick_target = target;
        changed
    }

    /// Packs every drawable point with its series slot. Within `MAX_POINT_SERIES` series this
    /// runs once per data set (the uniform hides / dims / reorders series); beyond it, hidden
    /// series are skipped and the emphasized one is dimmed / packed last here.
    pub(crate) fn build_points(&self, out: &mut Vec<ChartPointRaw>) {
        out.clear();
        out.reserve(self.len());
        let (w, h) = (self.layout.width, self.layout.height);
        let opacity = self.layout.opacity.clamp(0.0, 1.0);
        let baked = !self.series_in_uniform;
        let emphasis = self.emphasis.filter(|_| baked);
        let mut pass = |emphasized_pass: bool| {
            for (i, t) in self.t.iter().enumerate() {
                let s = self.series_of(i);
                let emphasized = emphasis == Some(s);
                if !t[0].is_finite() || (baked && !self.visible.get(s).copied().unwrap_or(true)) {
                    continue;
                }
                if emphasis.is_some() && emphasized != emphasized_pass {
                    continue;
                }
                let mut color = self.colors[i];
                let mut alpha = color[3] as f32 * opacity;
                if emphasis.is_some() && !emphasized {
                    alpha *= DIMMED_SERIES_ALPHA;
                }
                color[3] = alpha.round() as u8;
                let slot = self.packed_slot(if baked { 0.0 } else { s as f32 }, s);
                out.push(ChartPointRaw {
                    center_radius: [(t[0] - 0.5) * w, (t[1] - 0.5) * h, slot, self.radius(i)],
                    color,
                });
            }
        };
        pass(false);
        if emphasis.is_some() {
            pass(true);
        }
    }

    /// Horizontal gridlines at the y ticks (baseline at the plot bottom) and optional vertical
    /// ones at the x ticks, for the visible window.
    pub(crate) fn build_grid(&self, style: &ChartFrameStyle, out: &mut Vec<ChartSegmentRaw>) {
        out.clear();
        if !style.show_grid {
            return;
        }
        let z = -0.5;
        let (hw, hh) = (self.layout.width * 0.5, self.layout.height * 0.5);
        let (xs, ys) = self.ticks(style.grid_rows);
        let edge = |v: f32, at: f32, size: f32| (v - at).abs() < size * 1e-4;
        for v in ys {
            let y = self.world_y_of(v);
            if !edge(y, -hh, hh) {
                out.push(ChartSegmentRaw {
                    p0_width: [-hw, y, z, style.stroke_px],
                    p1_pad: [hw, y, z, 0.0],
                    color: style.grid_color,
                });
            }
        }
        if self.layout.grid_x {
            for v in xs {
                let x = self.world_x_of(v);
                out.push(ChartSegmentRaw {
                    p0_width: [x, -hh, z, style.stroke_px],
                    p1_pad: [x, hh, z, 0.0],
                    color: style.grid_color,
                });
            }
        }
        out.push(ChartSegmentRaw {
            p0_width: [-hw, -hh, z, style.stroke_px],
            p1_pad: [hw, -hh, z, 0.0],
            color: style.baseline_color,
        });
    }

    /// Plot rectangle and visible x / y ticks in CSS px.
    pub(crate) fn axes(&self, view: &ChartView, rows: u32, out: &mut AxisLayout) {
        out.ticks.clear();
        out.plot_css = [0.0; 4];
        let (hw, hh) = (self.layout.width * 0.5, self.layout.height * 0.5);
        let Some(plot) = plot_rect_css(view, hw, -hh, hh, 0.0) else {
            return;
        };
        out.plot_css = plot;
        let (xs, ys) = self.ticks(rows);
        for v in ys {
            if let Some((_, y)) = view.project_css(Vec3::new(-hw, self.world_y_of(v), 0.0)) {
                out.ticks.push(AxisTick { axis: 1, value: v, x_css: plot[0], y_css: y, granularity: 0 });
            }
        }
        let bottom = plot[1] + plot[3];
        for v in xs {
            if let Some((x, _)) = view.project_css(Vec3::new(self.world_x_of(v), -hh, 0.0)) {
                out.ticks.push(AxisTick { axis: 0, value: v, x_css: x, y_css: bottom, granularity: 0 });
            }
        }
    }

    /// Plot rect in physical px for scissoring points while zoomed.
    pub(crate) fn clip_px(&self, view: &ChartView) -> Option<[u32; 4]> {
        if self.window_x == (0.0, 1.0) && self.window_y == (0.0, 1.0) {
            return None;
        }
        let (hw, hh) = (self.layout.width * 0.5, self.layout.height * 0.5);
        let plot = plot_rect_css(view, hw, -hh, hh, 0.0)?;
        let pr = view.pixel_ratio;
        let (vw, vh) = (view.viewport_px.0 as f32, view.viewport_px.1 as f32);
        // Round outward so edge points keep their last pixel row / column
        let x0 = (plot[0] * pr).floor().clamp(0.0, vw);
        let y0 = (plot[1] * pr).floor().clamp(0.0, vh);
        let x1 = ((plot[0] + plot[2]) * pr).ceil().clamp(0.0, vw);
        let y1 = ((plot[1] + plot[3]) * pr).ceil().clamp(0.0, vh);
        Some([x0 as u32, y0 as u32, (x1 - x0).max(1.0) as u32, (y1 - y0).max(1.0) as u32])
    }

    #[inline]
    fn in_window(&self, t: [f32; 2]) -> bool {
        (self.window_x.0..=self.window_x.1).contains(&t[0]) && (self.window_y.0..=self.window_y.1).contains(&t[1])
    }

    /// Nearest visible point within the pick radius (or inside its own bubble) of the pointer.
    pub(crate) fn hover(&self, view: &ChartView, ndc: (f32, f32), style: &ChartHoverStyle) -> Option<HoverResult> {
        let ray = view.camera.screen_to_ray(ndc.0, ndc.1);
        let hit = ray_hit_z_plane(&ray, 0.0)?;
        let cursor = view.ndc_to_px(ndc.0, ndc.1);
        let (hw, hh) = (self.layout.width * 0.5, self.layout.height * 0.5);
        let a = view.project_px(Vec3::new(-hw, -hh, 0.0))?;
        let b = view.project_px(Vec3::new(hw, hh, 0.0))?;
        // Physical px per unit of normalized domain on each axis
        let px_per_t = [
            (b.0 - a.0).abs().max(1.0) / (self.window_x.1 - self.window_x.0),
            (b.1 - a.1).abs().max(1.0) / (self.window_y.1 - self.window_y.0),
        ];
        let pr = view.pixel_ratio;
        let limit = style.hit_radius_px * pr;
        let reach = limit.max(self.max_radius_px * pr);
        let c = self.t_of_world(hit.x, hit.y);
        let (rx, ry) = (reach / px_per_t[0], reach / px_per_t[1]);
        let mut best: Option<(usize, f32)> = None;
        self.grid.for_each_in([c[0] - rx, c[1] - ry], [c[0] + rx, c[1] + ry], |i| {
            let t = self.t[i];
            if !self.in_window(t) || !self.visible.get(self.series_of(i)).copied().unwrap_or(true) {
                return;
            }
            let Some(p) = view.project_px(self.point(i)) else {
                return;
            };
            let d = ((p.0 - cursor.0).powi(2) + (p.1 - cursor.1).powi(2)).sqrt();
            if d <= limit.max(self.radius(i) * pr) && best.is_none_or(|(_, bd)| d < bd) {
                best = Some((i, d));
            }
        });
        let (i, _) = best?;
        Some(HoverResult {
            is_bar: false,
            primary: 0,
            items: vec![HoverItem {
                series: self.series_of(i) as u32,
                index: i as u32,
                value: self.ys[i],
                global_id: i as u32,
            }],
        })
    }

    pub(crate) fn build_overlay(&self, hover: &HoverResult, style: &ChartHoverStyle, markers: &mut Vec<ChartMarkerRaw>) {
        markers.clear();
        if !style.marker {
            return;
        }
        for item in &hover.items {
            let i = item.index as usize;
            // Zoom / pan can move the hovered point out of the plot: markers are not scissored
            if i >= self.len() || !self.in_window(self.t[i]) {
                continue;
            }
            let p = self.point(i);
            let c = self.colors[i];
            markers.push(ChartMarkerRaw {
                center_radius: [p.x, p.y, p.z, style.marker_radius_px.max(self.radius(i))],
                fill: [c[0] as f32 / 255.0, c[1] as f32 / 255.0, c[2] as f32 / 255.0, 1.0],
                ring: style.marker_ring_color,
                params: [style.marker_ring_px, self.shapes.get(self.series_of(i)).copied().unwrap_or(0) as f32, 0.0, 0.0],
            });
        }
    }

    pub(crate) fn frame_camera(&self, camera: &mut OrbitCamera, css: (f32, f32), padding: &ChartPadding) {
        frame_flat(camera, css, self.layout.width, self.layout.height, padding);
    }
}

impl ChartState {
    /// Shape per scatter series id (0 circle, 1 square, 2 diamond, 3 triangle); rebuilds the
    /// points when it changed. False (no-op) for other charts.
    pub fn set_scatter_shapes(&mut self, shapes: &[u8]) -> bool {
        let ChartKind::Scatter(s) = &mut self.kind else {
            return false;
        };
        let changed = s.set_shapes(shapes);
        if changed {
            self.dirty.points = true;
            self.dirty.overlay = true;
        }
        changed
    }

    /// Jitter of the scatter points (see `ScatterChart::set_jitter`); rebuilds points, axes and
    /// the hover grid when it changed. False for other charts.
    pub fn set_scatter_jitter(&mut self, x: f64, y: f64, seed: u32) -> bool {
        let ChartKind::Scatter(s) = &mut self.kind else {
            return false;
        };
        let changed = s.set_jitter(x, y, seed);
        if changed {
            self.hover = None;
            self.dirty = Dirty::all();
            self.axes_key = None;
        }
        changed
    }

    /// Rippling scatter series ids (`flags[id] != 0`) and the ripple; rebuilds the points and the
    /// point uniform when they changed. False for other charts.
    pub fn set_scatter_ripple(&mut self, flags: &[u8], opts: RippleOptions) -> bool {
        let ChartKind::Scatter(s) = &mut self.kind else {
            return false;
        };
        let changed = s.set_ripple(flags, opts);
        if changed {
            self.dirty.points = true;
            self.dirty.point_style = true;
        }
        changed
    }

    /// Ripple clock in seconds: only the point uniform changes. False (nothing to animate) when
    /// no series ripples.
    pub fn set_effect_time(&mut self, seconds: f32) -> bool {
        let ChartKind::Scatter(s) = &mut self.kind else {
            return false;
        };
        if !s.rippling() {
            return false;
        }
        s.effect_time_s = if seconds.is_finite() { seconds } else { 0.0 };
        self.dirty.point_style = true;
        true
    }
}

// Brush selection support (see brush.rs)
impl ScatterChart {
    /// Calls `f(id, normalized position)` for every point in the spatial-hash cells overlapping
    /// `[lo, hi]` (normalized domain space; callers test the exact bounds).
    pub(crate) fn for_each_candidate(&self, lo: [f32; 2], hi: [f32; 2], mut f: impl FnMut(usize, [f32; 2])) {
        self.grid.for_each_in(lo, hi, |i| f(i, self.t[i]));
    }

    /// `build_points` for a brush selection: unselected points first and dimmed, then the
    /// selected ones (`selected[id]`) on top at full strength. Runs once per selection change.
    pub(crate) fn build_points_selected(&self, selected: &[bool], out: &mut Vec<ChartPointRaw>) {
        out.clear();
        out.reserve(self.len());
        let (w, h) = (self.layout.width, self.layout.height);
        let opacity = self.layout.opacity.clamp(0.0, 1.0);
        let baked = !self.series_in_uniform;
        for pass in [false, true] {
            for (i, t) in self.t.iter().enumerate() {
                let s = self.series_of(i);
                if !t[0].is_finite() || (baked && !self.visible.get(s).copied().unwrap_or(true)) {
                    continue;
                }
                if selected.get(i).copied().unwrap_or(false) != pass {
                    continue;
                }
                let mut color = self.colors[i];
                let alpha = color[3] as f32 * opacity * if pass { 1.0 } else { DIMMED_SERIES_ALPHA };
                color[3] = alpha.round() as u8;
                let slot = self.packed_slot(if baked { 0.0 } else { s as f32 }, s);
                out.push(ChartPointRaw {
                    center_radius: [(t[0] - 0.5) * w, (t[1] - 0.5) * h, slot, self.radius(i)],
                    color,
                });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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

    fn scatter(xs: Vec<f32>, ys: Vec<f32>, series: Vec<u16>) -> ChartState {
        ChartState::new_scatter(
            ScatterPoints {
                xs,
                ys,
                series,
                series_colors: vec![[1.0, 0.0, 0.0, 1.0], [0.0, 0.0, 1.0, 1.0]],
                ..Default::default()
            },
            ScatterLayout::default(),
        )
    }

    fn framed(chart: &ChartState) -> OrbitCamera {
        let mut cam = flat_camera();
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        cam
    }

    fn inner(chart: &ChartState) -> &ScatterChart {
        match &chart.kind {
            ChartKind::Scatter(s) => s,
            _ => unreachable!(),
        }
    }

    /// NDC of a data point of the chart.
    fn ndc_of(chart: &ChartState, cam: &OrbitCamera, i: u32) -> (f32, f32) {
        let p = chart.sample(i).unwrap().3;
        let n = cam.project_to_ndc(p).unwrap();
        (n.x, n.y)
    }

    #[test]
    fn series_shapes_ride_in_the_slot_channel_and_export_as_paths() {
        use crate::renderer::{point_shape, point_slot};
        let mut chart = scatter(vec![0.0, 1.0, 2.0, 3.0], vec![0.0, 1.0, 2.0, 3.0], vec![0, 1, 2, 3]);
        // Series 1 square, 2 diamond, 3 beyond the list: circle; unknown codes fall back to circles
        assert!(chart.set_scatter_shapes(&[0, 1, 2]));
        assert!(!chart.set_scatter_shapes(&[0, 1, 2]), "unchanged");
        let cam = framed(&chart);
        let pts = chart.prepare_layers(&view(&cam)).points.unwrap().to_vec();
        let decoded: Vec<(usize, f32)> = pts.iter().map(|p| (point_slot(p.center_radius[2]), point_shape(p.center_radius[2]))).collect();
        assert_eq!(decoded, vec![(0, 0.0), (1, 1.0), (2, 2.0), (3, 0.0)]);
        chart.set_scatter_shapes(&[9, 3]);
        let pts = chart.prepare_layers(&view(&cam)).points.unwrap().to_vec();
        assert_eq!((point_shape(pts[0].center_radius[2]), point_shape(pts[1].center_radius[2])), (0.0, 3.0));
        // Legend emphasis still finds the series slot under the shape bits
        chart.set_emphasis(Some(1));
        let style = chart.prepare_layers(&view(&cam)).point_style.unwrap();
        assert_eq!(style.emphasized_slot(), Some(1));
        // SVG: circles stay <circle>, other shapes are paths
        chart.set_emphasis(None);
        let svg = chart.export_svg(&view(&cam), 1000, "t").markup;
        let points = &svg[svg.find("data-layer=\"points\"").expect("points layer")..];
        assert_eq!(points.matches("<circle").count(), 3, "{points}");
        assert_eq!(points.matches("<path d=\"M").count(), 1, "the triangle");
    }

    #[test]
    fn ripple_series_carry_a_flag_and_time_only_touches_the_uniform() {
        use crate::renderer::{point_ripple, point_shape, point_slot};
        let mut chart = scatter(vec![0.0, 1.0, 2.0], vec![0.0, 1.0, 2.0], vec![0, 1, 2]);
        let cam = framed(&chart);
        chart.prepare_layers(&view(&cam));
        // No ripple: the clock is a no-op (no loop needed, nothing re-uploaded)
        assert!(!chart.set_effect_time(1.0));
        assert!(chart.prepare_layers(&view(&cam)).point_style.is_none());

        chart.set_scatter_shapes(&[0, 3]);
        let opts = RippleOptions { period_s: 2.0, scale: 3.0, count: 4, fill: true };
        assert!(chart.set_scatter_ripple(&[0, 1], opts));
        let layers = chart.prepare_layers(&view(&cam));
        let pts = layers.points.unwrap().to_vec();
        let style = layers.point_style.unwrap();
        let decoded: Vec<(usize, f32, bool)> = pts.iter().map(|p| {
            let z = p.center_radius[2];
            (point_slot(z), point_shape(z), point_ripple(z))
        }).collect();
        assert_eq!(decoded, vec![(0, 0.0, false), (1, 3.0, true), (2, 0.0, false)]);
        assert_eq!(style.effect, [2.0, 3.0, 4.0, 1.0]);
        // The clock only rewrites the uniform
        assert!(chart.set_effect_time(1.25));
        let layers = chart.prepare_layers(&view(&cam));
        assert!(layers.points.is_none());
        assert_eq!(layers.point_style.unwrap().params[2], 1.25);
        // Options are clamped; turning every series off stops the clock
        let wild = RippleOptions { period_s: 0.0, scale: 50.0, count: 99, fill: false };
        chart.set_scatter_ripple(&[1], wild);
        let style = chart.prepare_layers(&view(&cam)).point_style.unwrap();
        assert_eq!(style.effect, [0.1, 10.0, 8.0, 0.0]);
        chart.set_scatter_ripple(&[], wild);
        assert!(!chart.set_effect_time(2.0));
    }

    #[test]
    fn jitter_spreads_points_deterministically_in_data_units() {
        // Four categories, 50 points each, all on the same x
        let xs: Vec<f32> = (0..200).map(|i| (i % 4) as f32).collect();
        let ys: Vec<f32> = (0..200).map(|i| (i / 4) as f32).collect();
        let mut chart = scatter(xs.clone(), ys.clone(), vec![]);
        let before = inner(&chart).t.clone();
        assert!(chart.set_scatter_jitter(0.3, 0.0, 7));
        assert!(!chart.set_scatter_jitter(0.3, 0.0, 7), "unchanged");
        let s = inner(&chart);
        let (dx0, dx1) = s.x_domain;
        let offsets: Vec<f64> = s.t.iter().zip(&xs).map(|(t, &x)| dx0 + t[0] as f64 * (dx1 - dx0) - x as f64).collect();
        // Uniform in [-0.3, 0.3] (ggplot2 geom_jitter width), spread, y untouched
        assert!(offsets.iter().all(|o| o.abs() <= 0.3 + 1e-4), "{offsets:?}");
        let spread = offsets.iter().cloned().fold(f64::MIN, f64::max) - offsets.iter().cloned().fold(f64::MAX, f64::min);
        assert!(spread > 0.5, "spread {spread}");
        let mean = offsets.iter().sum::<f64>() / offsets.len() as f64;
        assert!(mean.abs() < 0.05, "centered: {mean}");
        let (dy0, dy1) = s.y_domain;
        assert!(s.t.iter().zip(&ys).all(|(t, &y)| (dy0 + t[1] as f64 * (dy1 - dy0) - y as f64).abs() < 1e-3));
        // Same seed = same offsets; another seed differs
        let mut again = scatter(xs.clone(), ys.clone(), vec![]);
        again.set_scatter_jitter(0.3, 0.0, 7);
        assert_eq!(inner(&again).t, s.t);
        let mut other = scatter(xs.clone(), ys.clone(), vec![]);
        other.set_scatter_jitter(0.3, 0.0, 8);
        assert_ne!(inner(&other).t, s.t);
        // Hover finds the jittered point and reports its real values
        let cam = framed(&chart);
        let v = view(&cam);
        chart.prepare_layers(&v);
        let mut scene = SceneWorld::new();
        for i in [0u32, 57, 133] {
            let hit = chart.hover_at(&v, &mut scene, ndc_of(&chart, &cam, i)).unwrap();
            assert_eq!(hit.items[0].index, i);
            assert_eq!(hit.items[0].value, ys[i as usize]);
        }
        // Off again: back to the exact positions
        chart.set_scatter_jitter(0.0, 0.0, 7);
        assert_eq!(inner(&chart).t, before);
    }

    #[test]
    fn domains_are_nice_on_both_axes_and_points_are_packed_once() {
        let mut chart = scatter(vec![3.0, 97.0, f32::NAN, 50.0], vec![-0.4, 2.3, 1.0, 1.0], vec![]);
        let s = inner(&chart);
        assert_eq!(s.x_domain, (0.0, 100.0));
        assert_eq!(s.y_domain, (-0.5, 2.5));
        let cam = framed(&chart);
        let layers = chart.prepare_layers(&view(&cam));
        let pts = layers.points.unwrap();
        assert_eq!(pts.len(), 3, "NaN point is skipped");
        // x = 50 is the centre of the domain; default series color, opacity applied
        assert_eq!(pts[2].center_radius[0], 0.0);
        assert_eq!(pts[2].color[..3], [255, 0, 0]);
        assert_eq!(pts[2].color[3], (255.0f32 * 0.85).round() as u8);
        assert!(layers.point_style.is_some());
        // Both axes emit ticks
        let axes = chart.axes().clone();
        assert!(axes.ticks.iter().any(|t| t.axis == 0) && axes.ticks.iter().any(|t| t.axis == 1));
        let ys: Vec<f64> = axes.ticks.iter().filter(|t| t.axis == 1).map(|t| t.value).collect();
        assert_eq!(ys, vec![-0.5, 0.0, 0.5, 1.0, 1.5, 2.0, 2.5]);
        // Static frame: nothing uploaded again
        let again = chart.prepare_layers(&view(&cam));
        assert!(again.points.is_none() && again.point_style.is_none() && again.underlay.is_none());
    }

    #[test]
    fn grid_hover_finds_the_nearest_point_within_the_radius() {
        // 200 x 200 lattice + one isolated point
        let n = 200;
        let mut xs = Vec::new();
        let mut ys = Vec::new();
        for k in 0..n * n {
            xs.push((k % n) as f32);
            ys.push((k / n) as f32);
        }
        let mut chart = scatter(xs, ys, vec![]);
        let cam = framed(&chart);
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        let target = 123 * n as u32 + 77;
        let (nx, ny) = ndc_of(&chart, &cam, target);
        // Nudge the pointer by ~1 px: still the same point
        let hit = chart.hover_at(&v, &mut scene, (nx + 1.0 / 800.0, ny)).expect("hit");
        assert_eq!(hit.items[0].global_id, target);
        assert_eq!(hit.items[0].index, target);
        assert_eq!(hit.items[0].value, 123.0);
        assert_eq!(chart.prepare_layers(&v).markers.unwrap().len(), 1);
        // Far outside the plot: nothing
        assert!(chart.hover_at(&v, &mut scene, (0.99, 0.99)).is_none());

        // Brute force agrees with the grid on random pointers
        let s = inner(&chart);
        let style = ChartHoverStyle { hit_radius_px: 6.0, ..Default::default() };
        for k in 0..50 {
            let ndc = ((k as f32 * 0.137).sin() * 0.6, (k as f32 * 0.071).cos() * 0.6);
            let got = s.hover(&v, ndc, &style).map(|h| h.items[0].index);
            let cursor = v.ndc_to_px(ndc.0, ndc.1);
            let brute = (0..s.len())
                .map(|i| {
                    let p = v.project_px(s.point(i)).unwrap();
                    (i, ((p.0 - cursor.0).powi(2) + (p.1 - cursor.1).powi(2)).sqrt())
                })
                .filter(|&(i, d)| d <= 6.0f32.max(s.radius(i)))
                .min_by(|a, b| a.1.total_cmp(&b.1))
                .map(|(i, _)| i as u32);
            assert_eq!(got, brute, "pointer {ndc:?}");
        }
    }

    #[test]
    fn hidden_series_are_culled_by_the_uniform_not_hovered_and_emphasis_draws_last() {
        let mut chart = scatter(vec![0.0, 10.0, 20.0], vec![0.0, 10.0, 20.0], vec![0, 1, 0]);
        assert_eq!(chart.series_count(), 2);
        let cam = framed(&chart);
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        let layers = chart.prepare_layers(&v);
        let pts = layers.points.unwrap();
        assert_eq!(pts.len(), 3);
        assert_eq!(pts.iter().map(|p| p.center_radius[2]).collect::<Vec<_>>(), vec![0.0, 1.0, 0.0], "series slots");
        let style = layers.point_style.unwrap();
        assert_eq!((style.slot_alpha(0), style.slot_alpha(1), style.emphasized_slot()), (1.0, 1.0, None));
        let p1 = ndc_of(&chart, &cam, 1);
        assert_eq!(chart.hover_at(&v, &mut scene, p1).unwrap().items[0].series, 1);

        chart.set_series_visible(1, false, &mut scene);
        assert!(!chart.series_visible(1));
        let layers = chart.prepare_layers(&v);
        assert!(layers.points.is_none(), "hiding only rewrites the uniform");
        assert_eq!(layers.point_style.unwrap().slot_alpha(1), 0.0, "hidden slot is culled");
        assert_eq!(layers.markers.unwrap().len(), 0, "hidden hovered point is cleared");
        assert!(chart.hover_at(&v, &mut scene, p1).is_none_or(|h| h.items[0].series == 0));

        chart.set_series_visible(1, true, &mut scene);
        chart.set_emphasis(Some(1));
        let layers = chart.prepare_layers(&v);
        assert!(layers.points.is_none());
        let style = layers.point_style.unwrap();
        assert_eq!(style.emphasized_slot(), Some(1), "emphasized series is drawn in a second pass");
        assert_eq!((style.slot_alpha(0), style.slot_alpha(1)), (DIMMED_SERIES_ALPHA, 1.0), "other series fade");
        chart.set_emphasis(None);
        let style = chart.prepare_layers(&v).point_style.unwrap();
        assert_eq!((style.slot_alpha(0), style.emphasized_slot()), (1.0, None));
    }

    #[test]
    fn legend_changes_upload_only_the_point_uniform() {
        use crate::renderer::{MockRenderBackend, RenderBackend};
        let n = 1_000_000;
        let mut chart = scatter(
            (0..n).map(|i| (i as f32 * 0.37).sin()).collect(),
            (0..n).map(|i| (i as f32 * 0.11).cos()).collect(),
            (0..n).map(|i| (i % 2) as u16).collect(),
        );
        let cam = framed(&chart);
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        let mut gpu = MockRenderBackend::default();
        gpu.sync_chart(&chart.prepare_layers(&v));
        assert_eq!((gpu.chart_point_uploads, gpu.chart_point_style_uploads), (1, 1));
        let initial = gpu.chart_point_bytes;
        assert_eq!(initial, n * size_of::<ChartPointRaw>() + size_of::<ChartPointStyleRaw>());

        for k in 0..4 {
            let before = gpu.chart_point_bytes;
            match k {
                0 => chart.set_emphasis(Some(1)),
                1 => chart.set_emphasis(None),
                _ => chart.set_series_visible(0, k == 3, &mut scene),
            }
            gpu.sync_chart(&chart.prepare_layers(&v));
            assert_eq!(gpu.chart_point_uploads, 1, "change {k} must not re-upload points");
            assert_eq!(gpu.chart_point_style_uploads, k + 2);
            // Was n * 20 bytes (20 MB at 1M points) per change; now the 1072-byte uniform
            assert_eq!(gpu.chart_point_bytes - before, size_of::<ChartPointStyleRaw>());
        }
        assert_eq!(gpu.chart_point_count, n);
    }

    #[test]
    fn more_series_than_uniform_slots_fall_back_to_repacking() {
        let n = MAX_POINT_SERIES + 1;
        let mut chart = scatter((0..n).map(|i| i as f32).collect(), (0..n).map(|i| i as f32).collect(), (0..n as u16).collect());
        let cam = framed(&chart);
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        let layers = chart.prepare_layers(&v);
        assert!(layers.points.unwrap().iter().all(|p| p.center_radius[2] == 0.0), "single slot");
        chart.set_series_visible(3, false, &mut scene);
        chart.set_emphasis(Some(n - 1));
        let last_x = (inner(&chart).t[n - 1][0] - 0.5) * 160.0;
        let style = inner(&chart).point_style(&ChartHoverStyle::default());
        assert_eq!((style.emphasized_slot(), style.slot_alpha(0), style.slot_alpha(3)), (None, 1.0, 1.0));
        let layers = chart.prepare_layers(&v);
        assert!(layers.point_style.is_none(), "baked into the points instead");
        let pts = layers.points.expect("re-packed");
        assert_eq!(pts.len(), n - 1, "hidden series skipped");
        assert_eq!(pts[n - 2].center_radius[0], last_x, "emphasized last");
        assert!(pts[0].color[3] < 60, "other series fade");
    }

    #[test]
    fn xy_zoom_keeps_the_anchor_moves_only_the_uniform_and_pans_clamp() {
        let mut chart = scatter((0..1000).map(|i| i as f32).collect(), (0..1000).map(|i| (i % 37) as f32).collect(), vec![]);
        let cam = framed(&chart);
        let v = view(&cam);
        chart.prepare_layers(&v);
        let anchor_id = 500;
        let before = chart.sample(anchor_id).unwrap().3;
        let a = ndc_of(&chart, &cam, anchor_id);
        chart.zoom_xy(&v, 0.25, a);
        let (x0, x1) = chart.x_window();
        let (y0, y1) = chart.y_window();
        assert!((x1 - x0 - 0.25).abs() < 1e-5 && (y1 - y0 - 0.25).abs() < 1e-5);
        let after = chart.sample(anchor_id).unwrap().3;
        assert!((after - before).length() < 1e-2, "anchor stays under the pointer");
        let layers = chart.prepare_layers(&v);
        assert!(layers.points.is_none(), "zoom never re-uploads points");
        let style = layers.point_style.expect("transform updated");
        assert!((style.transform[0] - 4.0).abs() < 1e-4);
        assert!(layers.underlay.is_some() && layers.series_clip.is_some());
        // The uniform maps the packed base position onto the CPU world position
        let base = inner(&chart).t[anchor_id as usize];
        let (w, h) = (160.0, 90.0);
        let gx = (base[0] - 0.5) * w * style.transform[0] + style.transform[2];
        let gy = (base[1] - 0.5) * h * style.transform[1] + style.transform[3];
        assert!((gx - after.x).abs() < 1e-3 && (gy - after.y).abs() < 1e-3);

        // A hovered point panned out of the plot loses its (unclipped) marker
        let mut scene = SceneWorld::new();
        chart.reset_zoom();
        let p0 = ndc_of(&chart, &cam, 0);
        assert!(chart.hover_at(&v, &mut scene, p0).is_some());
        assert_eq!(chart.prepare_layers(&v).markers.unwrap().len(), 1);
        chart.zoom_xy(&v, 0.25, (0.0, 0.0));
        assert_eq!(chart.prepare_layers(&v).markers.unwrap().len(), 0);

        // Drag far right / up: the window stops at the domain start
        chart.pan_xy(&v, 50.0, 50.0);
        assert_eq!(chart.x_window().0, 0.0);
        assert_eq!(chart.y_window().0, 0.0);
        chart.reset_zoom();
        assert_eq!((chart.x_window(), chart.y_window()), ((0.0, 1.0), (0.0, 1.0)));
        assert!(chart.prepare_layers(&v).series_clip.is_none());
    }

    #[test]
    fn bubble_sizes_extend_the_hit_area_and_vertical_grid_follows_x_ticks() {
        let mut chart = ChartState::new_scatter(
            ScatterPoints {
                xs: vec![0.0, 100.0],
                ys: vec![0.0, 100.0],
                sizes: vec![40.0, 2.0],
                ..Default::default()
            },
            ScatterLayout::default(),
        );
        let cam = framed(&chart);
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        let style = ChartHoverStyle { hit_radius_px: 4.0, marker_radius_px: 4.0, ..Default::default() };
        chart.set_hover_style(style, &mut scene);
        let (nx, ny) = ndc_of(&chart, &cam, 0);
        // 30 px from the bubble centre: inside its 40 px radius
        let hit = chart.hover_at(&v, &mut scene, (nx + 30.0 / 800.0, ny)).expect("inside bubble");
        assert_eq!(hit.items[0].index, 0);
        let layers = chart.prepare_layers(&v);
        assert_eq!(layers.markers.unwrap()[0].center_radius[3], 40.0, "marker covers the bubble");
        let grid = layers.underlay.unwrap();
        let vertical = grid.iter().filter(|s| s.p0_width[0] == s.p1_pad[0]).count();
        let xs = chart.axes().ticks.iter().filter(|t| t.axis == 0).count();
        assert!(vertical > 0 && vertical == xs, "{vertical} vs {xs}");
    }
}
