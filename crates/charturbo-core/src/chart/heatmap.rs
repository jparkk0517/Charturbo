//! Heatmap / matrix chart: a `cols x rows` value grid drawn as ONE textured quad.
//!
//! The values are uploaded once as a float texture; the fragment shader maps value -> [0, 1]
//! with the uniform scale (min / max, diverging center) and looks the color up in a 256-entry
//! colormap LUT built here (OKLab ramps, theme-aware). Zoom / pan only rewrite the uniform
//! window (nearest texel fetch keeps cells crisp), so 4096 x 4096 grids stay interactive; hover
//! is O(1) cell math with a two-tone cell outline in the overlay layer.

use super::*;
use crate::renderer::{ChartHeatmapGrid, ChartHeatmapStyleRaw, HEATMAP_LUT_SIZE};

/// Most cells a heatmap accepts (two 4096 x 4096 grids; one f32 texel each on the GPU).
pub const MAX_HEATMAP_CELLS: usize = 1 << 25;
/// Categorical x labels: at most one per this many CSS px.
const X_LABEL_SPACING_PX: f32 = 64.0;
/// Categorical y labels: at most one per this many CSS px.
const Y_LABEL_SPACING_PX: f32 = 16.0;
/// Hovered-cell outline: outer ring in the surface color, inner ring on top (CSS px).
const OUTLINE_OUTER_PX: f32 = 3.5;
const OUTLINE_INNER_PX: f32 = 1.5;
/// Colorbar tick target.
pub(crate) const COLORBAR_TICKS: u32 = 4;

/// Colormap family (see `colormap_lut`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ColormapKind {
    /// One hue, light -> dark (dark surfaces: dark -> light, low values recede into the surface)
    #[default]
    Sequential,
    Viridis,
    Magma,
    /// Blue <-> red arms around a neutral gray midpoint at the domain center
    Diverging,
}

impl ColormapKind {
    /// 0 = sequential, 1 = viridis, 2 = magma, 3 = diverging
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Viridis,
            2 => Self::Magma,
            3 => Self::Diverging,
            _ => Self::Sequential,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct HeatmapColormap {
    pub kind: ColormapKind,
    /// Sequential hue: its OKLCH hue / chroma drive the light -> dark ramp (`None` = blue)
    pub hue: Option<[f32; 4]>,
    /// Flip the ramp end for end
    pub reverse: bool,
    /// Chart surface: a dark surface flips the sequential / diverging lightness anchors
    pub surface: [f32; 4],
    /// Color of empty (NaN) cells; alpha 0 lets the surface show through
    pub empty: [f32; 4],
}

impl Default for HeatmapColormap {
    fn default() -> Self {
        Self {
            kind: ColormapKind::Sequential,
            hue: None,
            reverse: false,
            surface: CHART_SURFACE,
            empty: [0.0; 4],
        }
    }
}

/// Value domain overrides (`None` = from the data; diverging center defaults to 0 when the
/// data crosses it, else the middle, and an unset domain is made symmetric around it).
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct HeatmapDomain {
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub center: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct HeatmapLayout {
    /// World size of the plot (aspect ratio of the framed plot)
    pub width: f32,
    pub height: f32,
    /// Row 0 at the top (matrix / table order); false = at the bottom
    pub row0_top: bool,
    /// Data x of the grid's left / right edges; `None` = categorical columns (tick value =
    /// column index, cell centers at integers)
    pub x_extent: Option<(f64, f64)>,
    /// Data y of the grid's bottom / top edges; `None` = categorical rows (tick value = row index)
    pub y_extent: Option<(f64, f64)>,
}

impl Default for HeatmapLayout {
    fn default() -> Self {
        Self { width: 160.0, height: 90.0, row0_top: true, x_extent: None, y_extent: None }
    }
}

/// Resolved value -> [0, 1] mapping; mirrored exactly by the heatmap shader.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ValueScale {
    pub lo: f32,
    pub hi: f32,
    /// Diverging midpoint (maps to 0.5; each arm spans half of the colormap)
    pub center: Option<f32>,
}

impl ValueScale {
    /// Position of `v` on the colormap; `None` for empty (non-finite) cells.
    pub fn normalize(&self, v: f32) -> Option<f32> {
        if !v.is_finite() {
            return None;
        }
        let ramp = |a: f32, b: f32, flat: f32| if b > a { ((v - a) / (b - a)).clamp(0.0, 1.0) } else { flat };
        Some(match self.center {
            None => ramp(self.lo, self.hi, 0.5),
            Some(c) if v < c => 0.5 * ramp(self.lo, c, 0.0),
            // Flat arms saturate toward their end (center clamped onto a domain end)
            Some(c) if v > c => 0.5 + 0.5 * ramp(c, self.hi, 1.0),
            Some(_) => 0.5,
        })
    }

    /// LUT entry of a normalized position (same rounding as the shader).
    pub fn lut_index(t: f32) -> usize {
        ((t * (HEATMAP_LUT_SIZE - 1) as f32 + 0.5) as usize).min(HEATMAP_LUT_SIZE - 1)
    }

    pub(crate) fn resolve(data: (f64, f64), domain: &HeatmapDomain, diverging: bool) -> Self {
        let pick = |v: Option<f64>, d: f64| v.filter(|v| v.is_finite()).unwrap_or(d);
        let (mut lo, mut hi) = (pick(domain.min, data.0), pick(domain.max, data.1));
        if lo > hi {
            std::mem::swap(&mut lo, &mut hi);
        }
        if !diverging {
            return Self { lo: lo as f32, hi: hi as f32, center: None };
        }
        let c = pick(domain.center, if lo < 0.0 && hi > 0.0 { 0.0 } else { (lo + hi) * 0.5 });
        if domain.min.is_none() && domain.max.is_none() {
            // Equal magnitudes read as equal intensity on both arms
            let m = (c - lo).max(hi - c).max(0.0);
            (lo, hi) = (c - m, c + m);
        }
        Self { lo: lo as f32, hi: hi as f32, center: Some(c.clamp(lo, hi) as f32) }
    }
}

/// Rejects grids whose shape does not match the values or that exceed `MAX_HEATMAP_CELLS`.
pub fn validate_heatmap(cols: usize, rows: usize, len: usize) -> Result<(), String> {
    if cols == 0 || rows == 0 {
        return Err("heatmap needs at least one column and one row".into());
    }
    let cells = cols.checked_mul(rows).filter(|&n| n <= MAX_HEATMAP_CELLS);
    match cells {
        None => Err(format!("heatmap {cols} x {rows} exceeds {MAX_HEATMAP_CELLS} cells")),
        Some(n) if n != len => Err(format!("heatmap {cols} x {rows} needs {n} values, got {len}")),
        Some(_) => Ok(()),
    }
}

// -----------------------------------------------------------------------------
// Colormaps (OKLab interpolation, sRGB output)
// -----------------------------------------------------------------------------

/// Reference sequential blue, steps 100 -> 700 (light -> dark).
const SEQUENTIAL_BLUE: [u32; 13] = [
    0xcde2fb, 0xb7d3f6, 0x9ec5f4, 0x86b6ef, 0x6da7ec, 0x5598e7, 0x3987e5, 0x2a78d6, 0x256abf, 0x1c5cab, 0x184f95,
    0x104281, 0x0d366b,
];
/// Diverging anchors per surface: `(blue end, neutral midpoint, red hue source)`.
const DIVERGING_LIGHT: (u32, u32, u32) = (0x184f95, 0xf0efec, 0xe34948);
const DIVERGING_DARK: (u32, u32, u32) = (0x6da7ec, 0x383835, 0xe66767);

/// Polynomial fits (degree 6, sRGB) of matplotlib's viridis / magma.
const VIRIDIS: [[f32; 3]; 7] = [
    [0.277_727_33, 0.005_407_344_5, 0.334_099_8],
    [0.105_093_04, 1.404_613_5, 1.384_590_2],
    [-0.330_861_83, 0.214_847_56, 0.095_095_16],
    [-4.634_230_5, -5.799_101, -19.332_441],
    [6.228_27, 14.179_933, 56.690_55],
    [4.776_385, -13.745_145, -65.353_03],
    [-5.435_456, 4.645_852_6, 26.312_435],
];
const MAGMA: [[f32; 3]; 7] = [
    [-0.002_136_485, -0.000_749_655, -0.005_386_128],
    [0.251_660_54, 0.677_523_2, 2.494_026_6],
    [8.353_717, -3.577_719_5, 0.314_467_9],
    [-27.668_734, 14.264_731, -13.649_213],
    [52.176_14, -27.943_607, 12.944_169],
    [-50.768_524, 29.046_583, 4.234_153],
    [18.655_705, -11.489_774, -5.601_961_5],
];

fn hex_rgb(h: u32) -> [f32; 3] {
    [((h >> 16) & 255) as f32 / 255.0, ((h >> 8) & 255) as f32 / 255.0, (h & 255) as f32 / 255.0]
}

fn srgb_to_linear(c: f32) -> f32 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

fn linear_to_srgb(c: f32) -> f32 {
    if c <= 0.003_130_8 {
        12.92 * c
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    }
}

/// OKLab of an sRGB color (Ottosson 2020).
pub(crate) fn oklab(rgb: [f32; 3]) -> [f32; 3] {
    let [r, g, b] = rgb.map(srgb_to_linear);
    let l = (0.412_221_46 * r + 0.536_332_55 * g + 0.051_445_995 * b).cbrt();
    let m = (0.211_903_5 * r + 0.680_699_5 * g + 0.107_396_96 * b).cbrt();
    let s = (0.088_302_46 * r + 0.281_718_85 * g + 0.629_978_7 * b).cbrt();
    [
        0.210_454_26 * l + 0.793_617_8 * m - 0.004_072_047 * s,
        1.977_998_5 * l - 2.428_592_2 * m + 0.450_593_7 * s,
        0.025_904_037 * l + 0.782_771_77 * m - 0.808_675_77 * s,
    ]
}

fn oklab_to_linear(lab: [f32; 3]) -> [f32; 3] {
    let [ll, a, b] = lab;
    let l = (ll + 0.396_337_78 * a + 0.215_803_76 * b).powi(3);
    let m = (ll - 0.105_561_346 * a - 0.063_854_17 * b).powi(3);
    let s = (ll - 0.089_484_18 * a - 1.291_485_5 * b).powi(3);
    [
        4.076_741_7 * l - 3.307_711_6 * m + 0.230_969_94 * s,
        -1.268_438 * l + 2.609_757_4 * m - 0.341_319_38 * s,
        -0.004_196_086_3 * l - 0.703_418_6 * m + 1.707_614_7 * s,
    ]
}

fn rgba8(rgb: [f32; 3]) -> [u8; 4] {
    let [r, g, b] = rgb.map(|c| (c.clamp(0.0, 1.0) * 255.0).round() as u8);
    [r, g, b, 255]
}

fn oklab_rgba8(lab: [f32; 3]) -> [u8; 4] {
    rgba8(oklab_to_linear(lab).map(|c| linear_to_srgb(c.clamp(0.0, 1.0))))
}

/// OKLab point `(l, c, h)` with chroma reduced until it fits the sRGB gamut.
fn oklch_in_gamut(l: f32, c: f32, h: f32) -> [f32; 3] {
    let at = |c: f32| [l, c * h.cos(), c * h.sin()];
    let fits = |lab: [f32; 3]| oklab_to_linear(lab).iter().all(|v| (-1e-4..=1.0001).contains(v));
    if fits(at(c)) {
        return at(c);
    }
    let (mut lo, mut hi) = (0.0, c);
    for _ in 0..24 {
        let mid = 0.5 * (lo + hi);
        if fits(at(mid)) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    at(lo)
}

fn lerp3(a: [f32; 3], b: [f32; 3], t: f32) -> [f32; 3] {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/// Piecewise-linear OKLab interpolation through evenly spaced `stops` at `t` in [0, 1].
fn sample_stops(stops: &[[f32; 3]], t: f32) -> [f32; 3] {
    let pos = t.clamp(0.0, 1.0) * (stops.len() - 1) as f32;
    let i = (pos.floor() as usize).min(stops.len() - 2);
    lerp3(stops[i], stops[i + 1], pos - i as f32)
}

/// Light -> dark single-hue stops from `color`'s OKLCH hue / chroma (chroma peaks mid-ramp).
fn hue_ramp(color: [f32; 4]) -> Vec<[f32; 3]> {
    let [_, a, b] = oklab([color[0], color[1], color[2]].map(|v| v.clamp(0.0, 1.0)));
    let (c, h) = (a.hypot(b), b.atan2(a));
    (0..13)
        .map(|k| {
            let s = k as f32 / 12.0;
            let l = 0.95 - s * (0.95 - 0.30);
            oklch_in_gamut(l, c * (0.3 + 0.7 * (std::f32::consts::PI * s).sin()), h)
        })
        .collect()
}

fn polynomial(c: &[[f32; 3]; 7], t: f32) -> [f32; 3] {
    let mut out = [0.0; 3];
    for coeffs in c.iter().rev() {
        for k in 0..3 {
            out[k] = out[k] * t + coeffs[k];
        }
    }
    out
}

/// True for surfaces darker than mid-gray (OKLab L < 0.5).
pub(crate) fn is_dark_surface(surface: [f32; 4]) -> bool {
    oklab([surface[0], surface[1], surface[2]].map(|v| v.clamp(0.0, 1.0)))[0] < 0.5
}

/// `HEATMAP_LUT_SIZE` RGBA8 colors from low to high values.
pub fn colormap_lut(map: &HeatmapColormap) -> Vec<[u8; 4]> {
    let dark = is_dark_surface(map.surface);
    let last = (HEATMAP_LUT_SIZE - 1) as f32;
    let ts = (0..HEATMAP_LUT_SIZE).map(|i| i as f32 / last);
    let mut lut: Vec<[u8; 4]> = match map.kind {
        ColormapKind::Sequential => {
            let mut stops = match map.hue {
                None => SEQUENTIAL_BLUE.iter().map(|&h| oklab(hex_rgb(h))).collect(),
                Some(c) => hue_ramp(c),
            };
            // Low values sit nearest the surface: light ramp on light, dark ramp on dark
            if dark {
                stops.reverse();
            }
            ts.map(|t| oklab_rgba8(sample_stops(&stops, t))).collect()
        }
        ColormapKind::Viridis => ts.map(|t| rgba8(polynomial(&VIRIDIS, t))).collect(),
        ColormapKind::Magma => ts.map(|t| rgba8(polynomial(&MAGMA, t))).collect(),
        ColormapKind::Diverging => {
            let (blue, mid, red) = if dark { DIVERGING_DARK } else { DIVERGING_LIGHT };
            let (low, mid) = (oklab(hex_rgb(blue)), oklab(hex_rgb(mid)));
            // Red arm at the blue end's lightness: both arms step equally away from the midpoint
            let [_, a, b] = oklab(hex_rgb(red));
            let high = oklch_in_gamut(low[0], a.hypot(b), b.atan2(a));
            ts.map(|t| {
                let lab = if t < 0.5 { lerp3(low, mid, t * 2.0) } else { lerp3(mid, high, t * 2.0 - 1.0) };
                oklab_rgba8(lab)
            })
            .collect()
        }
    };
    if map.reverse {
        lut.reverse();
    }
    lut
}

// -----------------------------------------------------------------------------
// Chart
// -----------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub(crate) struct HeatmapChart {
    pub(crate) cols: usize,
    pub(crate) rows: usize,
    /// Row-major `rows x cols` (NaN = empty)
    values: Vec<f32>,
    pub(crate) layout: HeatmapLayout,
    /// Finite data extent (`(0, 1)` when every cell is empty)
    data_range: (f64, f64),
    domain: HeatmapDomain,
    colormap: HeatmapColormap,
    scale: ValueScale,
    lut: Vec<[u8; 4]>,
    /// Visible part of the grid per axis, normalized (y from the bottom); `(0, 1)` = everything
    pub(crate) window_x: (f32, f32),
    pub(crate) window_y: (f32, f32),
    /// Numeric x tick target for the current plot width (about one tick per 90 CSS px)
    x_tick_target: u32,
}

impl HeatmapChart {
    /// Grid of `cols x rows` values (padded with NaN / truncated to `cols * rows`).
    pub(crate) fn new(cols: usize, rows: usize, mut values: Vec<f32>, layout: HeatmapLayout) -> Self {
        let (cols, rows) = (cols.max(1), rows.max(1));
        values.resize(cols * rows, f32::NAN);
        let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
        for &v in values.iter().filter(|v| v.is_finite()) {
            lo = lo.min(v as f64);
            hi = hi.max(v as f64);
        }
        let data_range = if lo.is_finite() { (lo, hi) } else { (0.0, 1.0) };
        let colormap = HeatmapColormap::default();
        let domain = HeatmapDomain::default();
        Self {
            cols,
            rows,
            values,
            layout,
            data_range,
            domain,
            colormap,
            scale: ValueScale::resolve(data_range, &domain, false),
            lut: colormap_lut(&colormap),
            window_x: (0.0, 1.0),
            window_y: (0.0, 1.0),
            x_tick_target: 5,
        }
    }

    pub(crate) fn len(&self) -> usize {
        self.values.len()
    }

    pub(crate) fn grid(&self) -> ChartHeatmapGrid<'_> {
        ChartHeatmapGrid { cols: self.cols as u32, rows: self.rows as u32, values: &self.values }
    }

    pub(crate) fn lut(&self) -> &[[u8; 4]] {
        &self.lut
    }

    pub(crate) fn scale(&self) -> ValueScale {
        self.scale
    }

    pub(crate) fn style(&self) -> ChartHeatmapStyleRaw {
        let (hw, hh) = (self.layout.width * 0.5, self.layout.height * 0.5);
        let s = self.scale;
        ChartHeatmapStyleRaw {
            rect: [-hw, -hh, hw, hh],
            window: [self.window_x.0, self.window_x.1, self.window_y.0, self.window_y.1],
            grid: [self.cols as u32, self.rows as u32, 0, u32::from(self.layout.row0_top)],
            scale: [s.lo, s.hi, s.center.unwrap_or(0.0), if s.center.is_some() { 1.0 } else { 0.0 }],
            empty: self.colormap.empty,
        }
    }

    /// Applies a colormap; returns `(lut_changed, scale_changed)`.
    pub(crate) fn set_colormap(&mut self, map: HeatmapColormap) -> (bool, bool) {
        let lut = colormap_lut(&map);
        let lut_changed = lut != self.lut;
        self.lut = lut;
        self.colormap = map;
        (lut_changed, self.resolve_scale())
    }

    pub(crate) fn set_domain(&mut self, domain: HeatmapDomain) -> bool {
        self.domain = domain;
        self.resolve_scale()
    }

    fn resolve_scale(&mut self) -> bool {
        let diverging = self.colormap.kind == ColormapKind::Diverging;
        let scale = ValueScale::resolve(self.data_range, &self.domain, diverging);
        std::mem::replace(&mut self.scale, scale) != scale
    }

    /// Raw value of a cell (NaN = empty).
    pub(crate) fn value(&self, row: usize, col: usize) -> Option<f32> {
        (row < self.rows && col < self.cols).then(|| self.values[row * self.cols + col])
    }

    /// Displayed color of a value (the empty color for NaN).
    pub(crate) fn color_of(&self, v: f32) -> [u8; 4] {
        match self.scale.normalize(v) {
            Some(t) => self.lut[ValueScale::lut_index(t)],
            None => self.colormap.empty.map(|c| (c.clamp(0.0, 1.0) * 255.0).round() as u8),
        }
    }

    /// Colorbar ticks `(value, position in [0, 1])` over the scale domain.
    pub(crate) fn colorbar_ticks(&self) -> Vec<(f64, f32)> {
        let (lo, hi) = (self.scale.lo as f64, self.scale.hi as f64);
        ticks_between(lo, hi, nice_step(hi - lo, COLORBAR_TICKS))
            .into_iter()
            .filter_map(|v| self.scale.normalize(v as f32).map(|t| (v, t)))
            .collect()
    }

    /// Cell `(row, col)` at normalized grid position `t` (x right, y up), `None` outside.
    pub(crate) fn cell_at(&self, t: [f64; 2]) -> Option<(usize, usize)> {
        if !(0.0..=1.0).contains(&t[0]) || !(0.0..=1.0).contains(&t[1]) {
            return None;
        }
        let col = ((t[0] * self.cols as f64) as usize).min(self.cols - 1);
        let from_bottom = ((t[1] * self.rows as f64) as usize).min(self.rows - 1);
        Some((self.row_of(from_bottom), col))
    }

    /// Row index of the `k`-th row from the bottom (and back: the mapping is an involution).
    #[inline]
    fn row_of(&self, k: usize) -> usize {
        if self.layout.row0_top {
            self.rows - 1 - k
        } else {
            k
        }
    }

    /// Normalized rect `[x0, x1, y0, y1]` of a cell (y from the bottom).
    fn cell_rect_t(&self, row: usize, col: usize) -> [f64; 4] {
        let k = self.row_of(row) as f64;
        let (c, r) = (self.cols as f64, self.rows as f64);
        [col as f64 / c, (col + 1) as f64 / c, k / r, (k + 1.0) / r]
    }

    /// World xy of a normalized grid position under the zoom window.
    fn world_of_t(&self, t: [f64; 2]) -> (f32, f32) {
        let (wx, wy) = (self.window_x, self.window_y);
        let axis = |t: f64, w: (f32, f32), size: f32| {
            (((t - w.0 as f64) / ((w.1 - w.0) as f64).max(1e-12) - 0.5) * size as f64) as f32
        };
        (axis(t[0], wx, self.layout.width), axis(t[1], wy, self.layout.height))
    }

    /// Normalized grid position of a world point under the zoom window.
    fn t_of_world(&self, x: f32, y: f32) -> [f64; 2] {
        let axis = |v: f32, w: (f32, f32), size: f32| w.0 as f64 + (v as f64 / size as f64 + 0.5) * (w.1 - w.0) as f64;
        [axis(x, self.window_x, self.layout.width), axis(y, self.window_y, self.layout.height)]
    }

    /// Data units of the grid's left / right edges (categorical: column centers at integers).
    pub(crate) fn x_domain(&self) -> (f64, f64) {
        self.layout.x_extent.unwrap_or((-0.5, self.cols as f64 - 0.5))
    }

    /// Data units of the grid's bottom / top edges (categorical: row index, so reversed when
    /// row 0 is at the top).
    pub(crate) fn y_domain(&self) -> (f64, f64) {
        match self.layout.y_extent {
            Some(e) => e,
            None if self.layout.row0_top => (self.rows as f64 - 0.5, -0.5),
            None => (-0.5, self.rows as f64 - 0.5),
        }
    }

    fn range_of(domain: (f64, f64), w: (f32, f32)) -> (f64, f64) {
        let span = domain.1 - domain.0;
        let (a, b) = (domain.0 + w.0 as f64 * span, domain.0 + w.1 as f64 * span);
        (a.min(b), a.max(b))
    }

    fn window_of(domain: (f64, f64), lo: f64, hi: f64) -> Option<(f32, f32)> {
        let span = domain.1 - domain.0;
        if !lo.is_finite() || !hi.is_finite() || lo == hi || !span.is_finite() || span == 0.0 {
            return None;
        }
        let (a, b) = (((lo - domain.0) / span) as f32, ((hi - domain.0) / span) as f32);
        Some((a.min(b), a.max(b)))
    }

    /// Visible data range of the x / y axis (ascending).
    pub(crate) fn range_x(&self) -> (f64, f64) {
        Self::range_of(self.x_domain(), self.window_x)
    }

    pub(crate) fn range_y(&self) -> (f64, f64) {
        Self::range_of(self.y_domain(), self.window_y)
    }

    /// Zooms one axis to a data range (clamped like wheel zoom); true when the window moved.
    pub(crate) fn set_range_x(&mut self, lo: f64, hi: f64) -> bool {
        let Some(wx) = Self::window_of(self.x_domain(), lo, hi) else {
            return false;
        };
        let before = (self.window_x, self.window_y);
        self.set_window(wx, self.window_y);
        before != (self.window_x, self.window_y)
    }

    pub(crate) fn set_range_y(&mut self, lo: f64, hi: f64) -> bool {
        let Some(wy) = Self::window_of(self.y_domain(), lo, hi) else {
            return false;
        };
        let before = (self.window_x, self.window_y);
        self.set_window(self.window_x, wy);
        before != (self.window_x, self.window_y)
    }

    /// Smallest window span per axis: one cell (and at most the whole grid).
    fn min_span(cells: usize) -> f32 {
        (1.0 / cells as f32).clamp(1.0 / 65_536.0, 1.0)
    }

    pub(crate) fn set_window(&mut self, x: (f32, f32), y: (f32, f32)) {
        let clamp = |(a, b): (f32, f32), min: f32| {
            let span = (b - a).clamp(min, 1.0);
            let start = a.clamp(0.0, 1.0 - span);
            (start, start + span)
        };
        self.window_x = clamp(x, Self::min_span(self.cols));
        self.window_y = clamp(y, Self::min_span(self.rows));
    }

    /// Zooms both axes around the pointer (`factor` < 1 = in); true when the window moved.
    pub(crate) fn zoom_at(&mut self, view: &ChartView, factor: f32, anchor_ndc: (f32, f32)) -> bool {
        let (hw, hh) = (self.layout.width * 0.5, self.layout.height * 0.5);
        let ray = view.camera.screen_to_ray(anchor_ndc.0, anchor_ndc.1);
        let anchor = ray_hit_z_plane(&ray, 0.0)
            .map(|p| self.t_of_world(p.x.clamp(-hw, hw), p.y.clamp(-hh, hh)))
            .unwrap_or([
                ((self.window_x.0 + self.window_x.1) * 0.5) as f64,
                ((self.window_y.0 + self.window_y.1) * 0.5) as f64,
            ]);
        // Spans stop at one cell, so an axis at its limit keeps its window while the other zooms
        let zoom_axis = |(w0, w1): (f32, f32), a: f64, min: f32| {
            let span = w1 - w0;
            let new_span = (span * factor).clamp(min, 1.0);
            let a = (a as f32).clamp(w0, w1);
            let start = a - (a - w0) * (new_span / span.max(1e-9));
            (start, start + new_span)
        };
        let before = (self.window_x, self.window_y);
        let x = zoom_axis(self.window_x, anchor[0], Self::min_span(self.cols));
        let y = zoom_axis(self.window_y, anchor[1], Self::min_span(self.rows));
        self.set_window(x, y);
        before != (self.window_x, self.window_y)
    }

    /// Pans both axes by a pointer delta in NDC (+y = up); true when the window moved.
    pub(crate) fn pan_by(&mut self, view: &ChartView, delta_ndc: (f32, f32)) -> bool {
        let (hw, hh) = (self.layout.width * 0.5, self.layout.height * 0.5);
        let (Some(a), Some(b)) = (view.project_px(Vec3::new(-hw, -hh, 0.0)), view.project_px(Vec3::new(hw, hh, 0.0))) else {
            return false;
        };
        let (wx, wy) = (self.window_x, self.window_y);
        // Content follows the pointer: the window moves the opposite way
        let dx = -delta_ndc.0 * 0.5 * view.viewport_px.0 as f32 / (b.0 - a.0).abs().max(1.0) * (wx.1 - wx.0);
        let dy = -delta_ndc.1 * 0.5 * view.viewport_px.1 as f32 / (b.1 - a.1).abs().max(1.0) * (wy.1 - wy.0);
        self.set_window((wx.0 + dx, wx.1 + dx), (wy.0 + dy, wy.1 + dy));
        (wx, wy) != (self.window_x, self.window_y)
    }

    /// Updates the numeric x tick target from the plot width; true when it changed.
    pub(crate) fn sync_view(&mut self, view: &ChartView) -> bool {
        let (hw, hh) = (self.layout.width * 0.5, self.layout.height * 0.5);
        let Some(plot) = plot_rect_css(view, hw, -hh, hh, 0.0) else {
            return false;
        };
        let target = ((plot[2] / 90.0).floor() as u32).max(2);
        std::mem::replace(&mut self.x_tick_target, target) != target
    }

    /// `(row, col, value, world center)` of cell `global_id = row * cols + col`.
    pub(crate) fn sample(&self, global_id: u32) -> Option<(u32, u32, f32, Vec3)> {
        let id = global_id as usize;
        let (row, col) = (id / self.cols, id % self.cols);
        let v = self.value(row, col)?;
        let r = self.cell_rect_t(row, col);
        let (x, y) = self.world_of_t([(r[0] + r[1]) * 0.5, (r[2] + r[3]) * 0.5]);
        Some((row as u32, col as u32, v, Vec3::new(x, y, 0.0)))
    }

    /// The non-empty cell under the pointer: item `series` = row, `index` = column.
    pub(crate) fn hover(&self, view: &ChartView, ndc: (f32, f32)) -> Option<HoverResult> {
        let ray = view.camera.screen_to_ray(ndc.0, ndc.1);
        let hit = ray_hit_z_plane(&ray, 0.0)?;
        let (hw, hh) = (self.layout.width * 0.5, self.layout.height * 0.5);
        if hit.x.abs() > hw || hit.y.abs() > hh {
            return None;
        }
        let (row, col) = self.cell_at(self.t_of_world(hit.x, hit.y))?;
        let value = self.value(row, col).filter(|v| v.is_finite())?;
        Some(HoverResult {
            is_bar: false,
            primary: 0,
            items: vec![HoverItem {
                series: row as u32,
                index: col as u32,
                value,
                global_id: (row * self.cols + col) as u32,
            }],
        })
    }

    /// Two-tone outline of the hovered cell (surface ring + highlight ring), clipped to the plot.
    pub(crate) fn build_overlay(&self, hover: &HoverResult, style: &ChartHoverStyle, out: &mut Vec<ChartSegmentRaw>) {
        out.clear();
        let Some(item) = hover.items.first().filter(|_| style.marker) else {
            return;
        };
        let r = self.cell_rect_t(item.series as usize, item.index as usize);
        let (hw, hh) = (self.layout.width * 0.5, self.layout.height * 0.5);
        let (x0, y0) = self.world_of_t([r[0], r[2]]);
        let (x1, y1) = self.world_of_t([r[1], r[3]]);
        let (x0, x1, y0, y1) = (x0.max(-hw), x1.min(hw), y0.max(-hh), y1.min(hh));
        if x0 >= x1 || y0 >= y1 {
            return;
        }
        let c = style.crosshair_color;
        let inner = style.bar_highlight_color.unwrap_or([c[0], c[1], c[2], 1.0]);
        let corners = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)];
        for (color, width) in [(style.marker_ring_color, OUTLINE_OUTER_PX), (inner, OUTLINE_INNER_PX)] {
            for k in 0..4 {
                let (a, b) = (corners[k], corners[(k + 1) % 4]);
                out.push(ChartSegmentRaw {
                    p0_width: [a.0, a.1, 0.0, width],
                    p1_pad: [b.0, b.1, 0.0, 0.0],
                    color,
                });
            }
        }
    }

    /// Plot rectangle and visible ticks: numeric axes get nice ticks, categorical axes one label
    /// per visible cell, thinned so labels never collide.
    pub(crate) fn axes(&self, view: &ChartView, rows_target: u32, out: &mut AxisLayout) {
        out.ticks.clear();
        out.plot_css = [0.0; 4];
        let (hw, hh) = (self.layout.width * 0.5, self.layout.height * 0.5);
        let Some(plot) = plot_rect_css(view, hw, -hh, hh, 0.0) else {
            return;
        };
        out.plot_css = plot;
        let bottom = plot[1] + plot[3];
        // x: (data value, normalized position)
        for (v, t) in self.axis_ticks(0, self.x_tick_target, plot[2], X_LABEL_SPACING_PX) {
            let (x, _) = self.world_of_t([t, 0.0]);
            if let Some((cx, _)) = view.project_css(Vec3::new(x, -hh, 0.0)) {
                out.ticks.push(AxisTick { axis: 0, value: v, x_css: cx, y_css: bottom, granularity: 0 });
            }
        }
        for (v, t) in self.axis_ticks(1, rows_target, plot[3], Y_LABEL_SPACING_PX) {
            let (_, y) = self.world_of_t([0.0, t]);
            if let Some((_, cy)) = view.project_css(Vec3::new(-hw, y, 0.0)) {
                out.ticks.push(AxisTick { axis: 1, value: v, x_css: plot[0], y_css: cy, granularity: 0 });
            }
        }
    }

    /// Visible ticks `(value, normalized position)` of axis 0 (x) / 1 (y).
    fn axis_ticks(&self, axis: u8, target: u32, plot_px: f32, spacing_px: f32) -> Vec<(f64, f64)> {
        let (window, extent, cells) = if axis == 0 {
            (self.window_x, self.layout.x_extent, self.cols)
        } else {
            (self.window_y, self.layout.y_extent, self.rows)
        };
        let (w0, w1) = (window.0 as f64, window.1 as f64);
        if let Some((a, b)) = extent {
            let (lo, hi) = Self::range_of((a, b), window);
            let span = b - a;
            return ticks_between(lo, hi, nice_step(hi - lo, target))
                .into_iter()
                .map(|v| (v, (v - a) / span))
                .filter(|&(_, t)| t >= w0 - 1e-9 && t <= w1 + 1e-9)
                .collect();
        }
        // Categorical: label cell centers, every `every`-th index (stable while panning)
        let n = cells as f64;
        let visible = (w1 - w0) * n;
        let every = ((visible * spacing_px as f64 / plot_px.max(1.0) as f64).ceil() as usize).max(1);
        let first = (w0 * n).floor().max(0.0) as usize;
        let last = ((w1 * n).ceil() as usize).min(cells);
        (first..last)
            .filter_map(|k| {
                // k counts from the left / bottom; the label value is the column / row index
                let index = if axis == 0 { k } else { self.row_of(k) };
                let t = (k as f64 + 0.5) / n;
                (index % every == 0 && t >= w0 && t <= w1).then_some((index as f64, t))
            })
            .collect()
    }

    pub(crate) fn frame_camera(&self, camera: &mut OrbitCamera, css: (f32, f32), padding: &ChartPadding) {
        frame_flat(camera, css, self.layout.width, self.layout.height, padding);
    }
}

/// Colorbar of the active heatmap: scale domain and ticks.
#[derive(Debug, Clone, PartialEq)]
pub struct HeatmapColorbar {
    pub scale: ValueScale,
    /// `(value, position in [0, 1] along the colormap)`
    pub ticks: Vec<(f64, f32)>,
}

impl ChartState {
    /// Creates a heatmap of `cols x rows` row-major values (see `validate_heatmap`).
    pub fn new_heatmap(cols: usize, rows: usize, values: Vec<f32>, layout: HeatmapLayout) -> Self {
        Self::with_kind(ChartKind::Heatmap(HeatmapChart::new(cols, rows, values, layout)))
    }

    /// Replaces the heatmap colormap (re-uploads only the 1 KB LUT; a diverging switch also
    /// re-resolves the value scale).
    pub fn set_heatmap_colormap(&mut self, map: HeatmapColormap) {
        if let ChartKind::Heatmap(h) = &mut self.kind {
            let (lut, scale) = h.set_colormap(map);
            self.dirty.heatmap_lut |= lut;
            // The empty-cell color lives in the uniform too
            self.dirty.heatmap_style = true;
            if scale {
                // Cell colors in the tooltip / colorbar follow
                self.dirty.overlay = true;
            }
        }
        if let ChartKind::Calendar(c) = &mut self.kind {
            c.set_colormap(map);
            self.dirty.fills = true;
            self.dirty.overlay = true;
        }
    }

    /// Value domain overrides of the heatmap (min / max / diverging center).
    pub fn set_heatmap_domain(&mut self, domain: HeatmapDomain) {
        if let ChartKind::Heatmap(h) = &mut self.kind {
            self.dirty.heatmap_style |= h.set_domain(domain);
        }
        if let ChartKind::Calendar(c) = &mut self.kind {
            self.dirty.fills |= c.set_domain(domain);
        }
    }

    pub fn heatmap_lut(&self) -> Option<&[[u8; 4]]> {
        match &self.kind {
            ChartKind::Heatmap(h) => Some(h.lut()),
            ChartKind::Calendar(c) => Some(c.lut()),
            _ => None,
        }
    }

    pub fn heatmap_colorbar(&self) -> Option<HeatmapColorbar> {
        match &self.kind {
            ChartKind::Heatmap(h) => Some(HeatmapColorbar { scale: h.scale(), ticks: h.colorbar_ticks() }),
            ChartKind::Calendar(c) => Some(HeatmapColorbar { scale: c.scale(), ticks: c.colorbar_ticks() }),
            _ => None,
        }
    }

    /// Displayed RGBA8 color of a heatmap value (empty-cell color for NaN).
    pub fn heatmap_color(&self, value: f32) -> Option<[u8; 4]> {
        match &self.kind {
            ChartKind::Heatmap(h) => Some(h.color_of(value)),
            ChartKind::Calendar(c) => Some(c.color_of(value)),
            _ => None,
        }
    }

    /// `(cols, rows)` of the heatmap grid.
    pub fn heatmap_shape(&self) -> Option<(usize, usize)> {
        match &self.kind {
            ChartKind::Heatmap(h) => Some((h.cols, h.rows)),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::renderer::{MockRenderBackend, RenderBackend};

    fn view(cam: &OrbitCamera) -> ChartView<'_> {
        ChartView { camera: cam, viewport_px: (1600, 900), pixel_ratio: 1.0 }
    }

    fn heatmap(cols: usize, rows: usize, values: Vec<f32>) -> (ChartState, OrbitCamera) {
        let chart = ChartState::new_heatmap(cols, rows, values, HeatmapLayout::default());
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        (chart, cam)
    }

    fn inner(chart: &ChartState) -> &HeatmapChart {
        match &chart.kind {
            ChartKind::Heatmap(h) => h,
            _ => unreachable!(),
        }
    }

    /// NDC of a cell center.
    fn ndc_of(chart: &ChartState, cam: &OrbitCamera, row: usize, col: usize) -> (f32, f32) {
        let id = (row * inner(chart).cols + col) as u32;
        let n = cam.project_to_ndc(chart.sample(id).unwrap().3).unwrap();
        (n.x, n.y)
    }

    fn lightness(c: [u8; 4]) -> f32 {
        oklab([c[0], c[1], c[2]].map(|v| v as f32 / 255.0))[0]
    }

    #[test]
    fn values_normalize_linearly_or_around_a_diverging_center() {
        let lin = ValueScale { lo: 10.0, hi: 20.0, center: None };
        assert_eq!(lin.normalize(10.0), Some(0.0));
        assert_eq!(lin.normalize(15.0), Some(0.5));
        assert_eq!(lin.normalize(25.0), Some(1.0), "clamped");
        assert_eq!(lin.normalize(f32::NAN), None);
        assert_eq!(lin.normalize(f32::INFINITY), None);
        assert_eq!(ValueScale { lo: 3.0, hi: 3.0, center: None }.normalize(3.0), Some(0.5), "flat domain");

        // Asymmetric explicit domain: each arm spans half of the colormap
        let div = ValueScale { lo: -1.0, hi: 4.0, center: Some(0.0) };
        assert_eq!(div.normalize(-1.0), Some(0.0));
        assert_eq!(div.normalize(-0.5), Some(0.25));
        assert_eq!(div.normalize(0.0), Some(0.5));
        assert_eq!(div.normalize(2.0), Some(0.75));
        assert_eq!(div.normalize(9.0), Some(1.0));
        let top = ValueScale { lo: 0.0, hi: 10.0, center: Some(10.0) };
        assert_eq!((top.normalize(12.0), top.normalize(-1.0)), (Some(1.0), Some(0.0)), "flat arms saturate");
        assert_eq!(ValueScale::lut_index(0.5), 128);
        assert_eq!((ValueScale::lut_index(0.0), ValueScale::lut_index(1.0)), (0, 255));

        // Unset diverging domain is symmetric around 0; explicit ends are kept
        let auto = ValueScale::resolve((-1.0, 4.0), &HeatmapDomain::default(), true);
        assert_eq!(auto, ValueScale { lo: -4.0, hi: 4.0, center: Some(0.0) });
        let fixed = HeatmapDomain { min: Some(-1.0), max: Some(4.0), center: Some(1.0) };
        assert_eq!(ValueScale::resolve((-9.0, 9.0), &fixed, true), ValueScale { lo: -1.0, hi: 4.0, center: Some(1.0) });
        // Data not crossing 0: center defaults to the middle
        assert_eq!(ValueScale::resolve((2.0, 6.0), &HeatmapDomain::default(), true).center, Some(4.0));
        // Reversed / partial overrides
        let partial = HeatmapDomain { min: Some(50.0), max: Some(-50.0), center: None };
        assert_eq!(ValueScale::resolve((0.0, 1.0), &partial, false), ValueScale { lo: -50.0, hi: 50.0, center: None });
    }

    #[test]
    fn colormap_luts_have_monotonic_lightness_and_follow_the_surface() {
        let light = [0.988, 0.988, 0.984, 1.0];
        let dark = CHART_SURFACE;
        assert!(is_dark_surface(dark) && !is_dark_surface(light));
        let check = |lut: &[[u8; 4]], rising: bool, name: &str| {
            assert_eq!(lut.len(), HEATMAP_LUT_SIZE, "{name}");
            let l: Vec<f32> = lut.iter().map(|&c| lightness(c)).collect();
            for i in 1..l.len() {
                let d = if rising { l[i] - l[i - 1] } else { l[i - 1] - l[i] };
                // u8 quantization may wobble by a hair between neighbours
                assert!(d > -2e-3, "{name}: lightness not monotonic at {i}: {} -> {}", l[i - 1], l[i]);
            }
            for i in (8..l.len()).step_by(8) {
                let d = if rising { l[i] - l[i - 8] } else { l[i - 8] - l[i] };
                assert!(d > 0.0, "{name}: flat at {i}");
            }
            assert!((l[0] - l[255]).abs() > 0.4, "{name}: span {} -> {}", l[0], l[255]);
        };
        let map = |kind, surface, hue| HeatmapColormap { kind, surface, hue, ..Default::default() };
        let seq_light = colormap_lut(&map(ColormapKind::Sequential, light, None));
        check(&seq_light, false, "sequential light: light -> dark");
        assert_eq!(seq_light[0][..3], [0xcd, 0xe2, 0xfb], "starts on the reference step 100");
        assert_eq!(seq_light[255][..3], [0x0d, 0x36, 0x6b], "ends on step 700");
        let seq_dark = colormap_lut(&map(ColormapKind::Sequential, dark, None));
        check(&seq_dark, true, "sequential dark: anchor flips");
        assert_eq!(seq_dark[0], seq_light[255]);
        // Custom hue: same lightness law, the hue's own family
        let orange = colormap_lut(&map(ColormapKind::Sequential, light, Some([0.92, 0.41, 0.2, 1.0])));
        check(&orange, false, "sequential orange");
        assert!(orange[180][0] > orange[180][2], "stays orange");
        check(&colormap_lut(&map(ColormapKind::Viridis, light, None)), true, "viridis");
        check(&colormap_lut(&map(ColormapKind::Magma, dark, None)), true, "magma");
        let viridis = colormap_lut(&map(ColormapKind::Viridis, light, None));
        assert!(viridis[0][2] > viridis[0][1] && viridis[255][0] > 200 && viridis[255][2] < 80, "purple -> yellow");
        let reversed = colormap_lut(&HeatmapColormap { reverse: true, ..map(ColormapKind::Viridis, light, None) });
        assert_eq!(reversed[0], viridis[255]);

        // Diverging: each arm monotonic away from a neutral midpoint, equal end lightness
        for (surface, toward_ends_darker) in [(light, true), (dark, false)] {
            let lut = colormap_lut(&map(ColormapKind::Diverging, surface, None));
            let l: Vec<f32> = lut.iter().map(|&c| lightness(c)).collect();
            for i in 1..128 {
                let d = l[i] - l[i - 1];
                assert!(if toward_ends_darker { d > -2e-3 } else { d < 2e-3 }, "low arm at {i}");
            }
            for i in 129..256 {
                let d = l[i] - l[i - 1];
                assert!(if toward_ends_darker { d < 2e-3 } else { d > -2e-3 }, "high arm at {i}");
            }
            assert!((l[0] - l[255]).abs() < 0.02, "symmetric ends {} vs {}", l[0], l[255]);
            assert!(lut[0][2] > lut[0][0] && lut[255][0] > lut[255][2], "blue low, red high");
            let mid = oklab([lut[128][0], lut[128][1], lut[128][2]].map(|v| v as f32 / 255.0));
            assert!(mid[1].hypot(mid[2]) < 0.02, "neutral midpoint");
        }
    }

    #[test]
    fn hover_maps_the_pointer_to_the_cell_and_skips_empty_cells() {
        // 4 x 3 grid, row 0 on top; value = row * 10 + col; cell (1, 2) empty
        let mut values: Vec<f32> = (0..12).map(|i| ((i / 4) * 10 + i % 4) as f32).collect();
        values[6] = f32::NAN;
        let (mut chart, cam) = heatmap(4, 3, values);
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        let h = inner(&chart);
        // Pure cell math: top-left of the normalized grid is row 0, col 0
        assert_eq!(h.cell_at([0.01, 0.99]), Some((0, 0)));
        assert_eq!(h.cell_at([0.99, 0.01]), Some((2, 3)));
        assert_eq!(h.cell_at([1.0, 1.0]), Some((0, 3)), "far edges belong to the last cell");
        assert_eq!(h.cell_at([1.01, 0.5]), None);

        let hit = chart.hover_at(&v, &mut scene, ndc_of(&chart, &cam, 2, 1)).expect("cell");
        assert_eq!((hit.items[0].series, hit.items[0].index, hit.items[0].value), (2, 1, 21.0));
        assert_eq!(hit.items[0].global_id, 9);
        let sample = chart.sample(9).unwrap().3;
        let layers = chart.prepare_layers(&v);
        let outline = layers.overlay.unwrap();
        assert_eq!(outline.len(), 8, "outer + inner ring");
        let xs: Vec<f32> = outline.iter().map(|s| s.p0_width[0]).collect();
        let (lo, hi) = (xs.iter().copied().fold(f32::MAX, f32::min), xs.iter().copied().fold(f32::MIN, f32::max));
        assert!((lo - (sample.x - 20.0)).abs() < 1e-3 && (hi - (sample.x + 20.0)).abs() < 1e-3, "cell is 40 wide");

        // Empty cell and outside the plot: no hover, outline cleared
        assert!(chart.hover_at(&v, &mut scene, ndc_of(&chart, &cam, 1, 2)).is_none());
        assert_eq!(chart.prepare_layers(&v).overlay.unwrap().len(), 0);
        assert!(chart.hover_at(&v, &mut scene, (0.99, 0.99)).is_none());

        // Bottom-up rows flip the vertical mapping
        let layout = HeatmapLayout { row0_top: false, ..Default::default() };
        let flipped = HeatmapChart::new(4, 3, vec![0.0; 12], layout);
        assert_eq!(flipped.cell_at([0.01, 0.99]), Some((2, 0)));
    }

    #[test]
    fn grid_uploads_once_zoom_rewrites_only_the_uniform_and_keeps_the_anchor() {
        let (cols, rows) = (512, 256);
        let values: Vec<f32> = (0..cols * rows).map(|i| (i % 97) as f32).collect();
        let (mut chart, cam) = heatmap(cols, rows, values);
        let v = view(&cam);
        let mut gpu = MockRenderBackend::default();
        gpu.sync_chart(&chart.prepare_layers(&v));
        assert_eq!((gpu.chart_heatmap_uploads, gpu.chart_heatmap_cells), (1, cols * rows));
        assert_eq!((gpu.chart_heatmap_lut_uploads, gpu.chart_heatmap_style_uploads), (1, 1));
        let style = gpu.chart_heatmap_style.unwrap();
        assert_eq!(style.grid, [512, 256, 0, 1]);
        assert_eq!(style.scale, [0.0, 96.0, 0.0, 0.0]);

        let anchor = chart.sample(100 * cols as u32 + 300).unwrap().3;
        let a = cam.project_to_ndc(anchor).unwrap();
        chart.zoom_xy(&v, 0.25, (a.x, a.y));
        let (x0, x1) = chart.x_window();
        assert!((x1 - x0 - 0.25).abs() < 1e-5);
        let after = chart.sample(100 * cols as u32 + 300).unwrap().3;
        assert!((after - anchor).length() < 1e-2, "anchor cell stays under the pointer");
        gpu.sync_chart(&chart.prepare_layers(&v));
        assert_eq!(gpu.chart_heatmap_uploads, 1, "zoom never re-uploads the grid");
        assert_eq!(gpu.chart_heatmap_style_uploads, 2);
        assert_eq!(gpu.chart_heatmap_style.unwrap().window[..2], [x0, x1]);

        // Zoom stops at one cell per axis; pan clamps to the grid
        for _ in 0..40 {
            chart.zoom_xy(&v, 0.5, (0.0, 0.0));
        }
        let (x0, x1) = chart.x_window();
        let (y0, y1) = chart.y_window();
        assert!((x1 - x0 - 1.0 / 512.0).abs() < 1e-6 && (y1 - y0 - 1.0 / 256.0).abs() < 1e-6);
        // One viewport shows one cell: a 4096-viewport drag reaches the bottom-left corner
        chart.pan_xy(&v, 4096.0, 4096.0);
        assert_eq!((chart.x_window().0, chart.y_window().0), (0.0, 0.0));
        chart.reset_zoom();
        assert_eq!((chart.x_window(), chart.y_window()), ((0.0, 1.0), (0.0, 1.0)));

        // Colormap / domain changes: LUT or uniform only
        chart.set_heatmap_colormap(HeatmapColormap { kind: ColormapKind::Magma, ..Default::default() });
        chart.set_heatmap_domain(HeatmapDomain { min: Some(10.0), max: Some(20.0), center: None });
        gpu.sync_chart(&chart.prepare_layers(&v));
        assert_eq!((gpu.chart_heatmap_uploads, gpu.chart_heatmap_lut_uploads), (1, 2));
        assert_eq!(gpu.chart_heatmap_style.unwrap().scale[..2], [10.0, 20.0]);
        let again = chart.prepare_layers(&v);
        assert!(again.heatmap.is_none() && again.heatmap_lut.is_none() && again.heatmap_style.is_none());
    }

    #[test]
    fn categorical_axes_thin_labels_and_numeric_extents_get_nice_ticks() {
        let (mut chart, cam) = heatmap(400, 300, vec![1.0; 120_000]);
        let v = view(&cam);
        chart.prepare_layers(&v);
        let axes = chart.axes().clone();
        let xs: Vec<f64> = axes.ticks.iter().filter(|t| t.axis == 0).map(|t| t.value).collect();
        let ys: Vec<f64> = axes.ticks.iter().filter(|t| t.axis == 1).map(|t| t.value).collect();
        assert_eq!(xs[0], 0.0, "column 0 is labelled");
        assert!(xs.len() > 3 && (xs.len() as f32) <= axes.plot_css[2] / X_LABEL_SPACING_PX + 1.0, "{} x labels", xs.len());
        let gaps: Vec<f32> = axes.ticks.iter().filter(|t| t.axis == 0).map(|t| t.x_css).collect::<Vec<_>>().windows(2).map(|w| w[1] - w[0]).collect();
        assert!(gaps.iter().all(|&g| g >= X_LABEL_SPACING_PX - 1.0), "labels never collide: {gaps:?}");
        assert!(ys.contains(&0.0) && (ys.len() as f32) <= axes.plot_css[3] / Y_LABEL_SPACING_PX + 1.0);
        // Row 0 on top: its label is the highest one (smallest css y)
        let top = axes.ticks.iter().filter(|t| t.axis == 1).min_by(|a, b| a.y_css.total_cmp(&b.y_css)).unwrap();
        assert_eq!(top.value, 0.0);

        // Zoomed in, every visible column gets its label
        chart.set_x_range_data(10.0, 14.0);
        chart.prepare_layers(&v);
        let xs: Vec<f64> = chart.axes().ticks.iter().filter(|t| t.axis == 0).map(|t| t.value).collect();
        assert!(xs.contains(&11.0) && xs.contains(&12.0), "{xs:?}");
        let (lo, hi) = chart.x_range_data().unwrap();
        assert!((lo - 10.0).abs() < 1e-3 && (hi - 14.0).abs() < 1e-3, "range in column units ({lo}, {hi})");

        let layout = HeatmapLayout { x_extent: Some((0.0, 1000.0)), y_extent: Some((-5.0, 5.0)), ..Default::default() };
        let mut numeric = ChartState::new_heatmap(10, 10, vec![0.0; 100], layout);
        numeric.prepare_layers(&v);
        let ys: Vec<f64> = numeric.axes().ticks.iter().filter(|t| t.axis == 1).map(|t| t.value).collect();
        assert!(ys.contains(&0.0) && ys.len() >= 3, "{ys:?}");
        assert!(ys.iter().all(|y| (-5.0..=5.0).contains(y)), "nice ticks inside the extent: {ys:?}");
        assert_eq!(numeric.y_range_data(), Some((-5.0, 5.0)));
    }

    #[test]
    fn colorbar_and_colors_follow_the_scale_and_nan_uses_the_empty_color() {
        let (mut chart, _) = heatmap(3, 1, vec![-2.0, f32::NAN, 6.0]);
        let empty = [0.5, 0.5, 0.5, 1.0];
        chart.set_heatmap_colormap(HeatmapColormap { kind: ColormapKind::Diverging, empty, ..Default::default() });
        let bar = chart.heatmap_colorbar().unwrap();
        assert_eq!(bar.scale, ValueScale { lo: -6.0, hi: 6.0, center: Some(0.0) });
        assert!(bar.ticks.contains(&(0.0, 0.5)), "{:?}", bar.ticks);
        assert!(bar.ticks.iter().all(|&(_, t)| (0.0..=1.0).contains(&t)));
        let lut = chart.heatmap_lut().unwrap().to_vec();
        assert_eq!(chart.heatmap_color(6.0), Some(lut[255]));
        assert_eq!(chart.heatmap_color(0.0), Some(lut[128]));
        assert_eq!(chart.heatmap_color(f32::NAN), Some([128, 128, 128, 255]));
        assert_eq!(chart.heatmap_shape(), Some((3, 1)));
        assert_eq!(chart.point_count(), 3);
        // Empty data still gets a valid scale
        let (blank, _) = heatmap(2, 2, vec![f32::NAN; 4]);
        assert_eq!(blank.heatmap_colorbar().unwrap().scale, ValueScale { lo: 0.0, hi: 1.0, center: None });
    }

    #[test]
    fn grid_shape_is_validated() {
        assert!(validate_heatmap(4, 3, 12).is_ok());
        assert!(validate_heatmap(4, 3, 11).is_err());
        assert!(validate_heatmap(0, 3, 0).is_err());
        assert!(validate_heatmap(1 << 20, 1 << 20, 0).is_err());
        assert!(validate_heatmap(4096, 4096, 4096 * 4096).is_ok(), "16M cells");
    }
}
