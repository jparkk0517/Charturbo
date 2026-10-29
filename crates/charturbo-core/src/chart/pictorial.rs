//! Pictorial bars (ECharts `pictorialBar`): a 2D bar chart whose bars are drawn as symbols
//! (built-in shapes or `path://` SVG paths) stretched over the bar or repeated along it, with
//! optional clipping at the data value. The bar layout (axes, categories, orientation, stacking,
//! hover, background tracks) is the bar chart's; only the bar marks are replaced by fill
//! triangles built here in world space from CSS-pixel sizes.
//!
//! Symbols are tessellated once into unit-box triangles (`[-0.5, 0.5]²`, y up) when the chart
//! is configured; each frame that moves the bars (data, hover, emphasis, legend, resize) places
//! them per bar: scale to the symbol size, mirror on negative bars, rotate, translate, clip.

use super::bar::{BarChart, BarSeg};
use super::line::DIMMED_SERIES_ALPHA;
use super::*;

/// Floats per bar in `set_bar_pictorial` records (see `PictorialSpec::from_record`).
pub const PICTORIAL_STRIDE: usize = 19;

/// Symbols repeated along one bar at most.
pub const MAX_PICTORIAL_REPEAT: u32 = 1000;

/// Fill vertices of a pictorial chart at most (further symbols are dropped).
const MAX_PICTORIAL_VERTICES: usize = 1_500_000;

/// Edges of one tessellated `path://` symbol at most (the crossing search is O(edges²)).
const MAX_PATH_EDGES: usize = 4096;

/// Edge crossings of one `path://` symbol at most: each adds a slab, and the slab pass is
/// O(slabs x edges), so dense self-crossing paths are rejected instead of freezing the thread.
const MAX_PATH_CROSSINGS: usize = 4096;

/// Length in CSS px, or a percent of a reference length.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Dim {
    pub(crate) v: f32,
    pub(crate) pct: bool,
}

impl Dim {
    fn of(self, reference: f32) -> f32 {
        if self.pct {
            self.v * 0.01 * reference
        } else {
            self.v
        }
    }
}

/// `symbolRepeat`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum Repeat {
    /// One symbol
    Off,
    /// `true`: as many as fit the bar length
    Auto,
    /// `'fixed'`: as many as fit the bounding length, whatever the value
    Fixed,
    /// That many
    Times(u32),
}

/// `symbolPosition` along the value axis.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SymbolPosition {
    Start,
    End,
    Center,
}

/// Symbol options of one bar.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct PictorialSpec {
    pub(crate) symbol: usize,
    pub(crate) repeat: Repeat,
    /// Screen `[width, height]`; percents of the bar thickness on the category axis, of the
    /// bounding length (or the bar thickness when repeating) on the value axis
    pub(crate) size: [Dim; 2],
    /// Gap at each side of a repeated symbol (percent of its value-axis size)
    pub(crate) margin: Dim,
    /// Gaps at both ends of the repeated run too (`symbolMargin: '…!'`)
    pub(crate) end_gap: bool,
    pub(crate) clip: bool,
    pub(crate) position: SymbolPosition,
    /// Screen `[right, down]` offset; percents of the symbol size
    pub(crate) offset: [Dim; 2],
    /// Degrees, counterclockwise
    pub(crate) rotate_deg: f32,
    /// `symbolBoundingData` value-unit extents `(negative bars, positive bars)`
    pub(crate) bounding: Option<(f32, f32)>,
}

/// Symbols of a pictorial bar chart.
#[derive(Debug, Clone)]
pub(crate) struct Pictorial {
    /// Unit-box triangles of each symbol (empty for `none`)
    pub(crate) shapes: Vec<Vec<[f32; 2]>>,
    /// Per bar id (`series * categories + category`)
    pub(crate) specs: Vec<PictorialSpec>,
    /// World units per CSS px of the last build
    pub(crate) built_wpp: Option<f32>,
}

/// Whether `symbol` is a pictorial symbol: a built-in name or a valid `path://` path.
pub fn pictorial_symbol_valid(symbol: &str) -> bool {
    symbol_triangles(symbol).is_some()
}

/// Unit-box triangles of a symbol (`None` = unknown name / invalid path).
pub(crate) fn symbol_triangles(symbol: &str) -> Option<Vec<[f32; 2]>> {
    if let Some(d) = symbol.strip_prefix("path://") {
        return path_triangles(d);
    }
    Some(match symbol {
        "none" => Vec::new(),
        "rect" | "square" => fan(&[[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]),
        "roundRect" => fan(&round_rect(0.125, 8)),
        "circle" => fan(&ellipse(64)),
        "triangle" => vec![[0.0, 0.5], [-0.5, -0.5], [0.5, -0.5]],
        "diamond" => fan(&[[0.0, 0.5], [-0.5, 0.0], [0.0, -0.5], [0.5, 0.0]]),
        // Arrowhead pointing up with a notch at the bottom (concave: two triangles)
        "arrow" => vec![
            [0.0, 0.5],
            [-0.5, -0.5],
            [0.0, -0.25],
            [0.0, 0.5],
            [0.0, -0.25],
            [0.5, -0.5],
        ],
        "pin" => fan(&pin(48)),
        _ => return None,
    })
}

/// Triangle fan of a convex polygon.
fn fan(pts: &[[f32; 2]]) -> Vec<[f32; 2]> {
    (1..pts.len().saturating_sub(1))
        .flat_map(|i| [pts[0], pts[i], pts[i + 1]])
        .collect()
}

fn ellipse(n: usize) -> Vec<[f32; 2]> {
    (0..n)
        .map(|i| {
            let (s, c) = (i as f32 / n as f32 * std::f32::consts::TAU).sin_cos();
            [0.5 * c, 0.5 * s]
        })
        .collect()
}

/// Unit square with corners of radius `r`, `k` segments per corner.
fn round_rect(r: f32, k: usize) -> Vec<[f32; 2]> {
    let centers = [
        [0.5 - r, 0.5 - r],
        [-0.5 + r, 0.5 - r],
        [-0.5 + r, -0.5 + r],
        [0.5 - r, -0.5 + r],
    ];
    let mut pts = Vec::with_capacity(4 * (k + 1));
    for (q, c) in centers.iter().enumerate() {
        for j in 0..=k {
            let a = (q as f32 + j as f32 / k as f32) * std::f32::consts::FRAC_PI_2;
            pts.push([c[0] + r * a.cos(), c[1] + r * a.sin()]);
        }
    }
    pts
}

/// Map pin: a round head with tangent sides meeting in the bottom tip, stretched to the box.
fn pin(n: usize) -> Vec<[f32; 2]> {
    let (r, cy, tip) = (0.35f32, 0.15f32, -0.5f32);
    let alpha = (r / (cy - tip)).acos();
    let start = -std::f32::consts::FRAC_PI_2 + alpha;
    let span = std::f32::consts::TAU - 2.0 * alpha;
    let mut pts = vec![[0.0, tip]];
    pts.extend((0..=n).map(|i| {
        let a = start + span * i as f32 / n as f32;
        [r * a.cos(), cy + r * a.sin()]
    }));
    // Stretch the head to the full box width / height
    for p in &mut pts {
        p[0] *= 0.5 / r;
        p[1] = (p[1] - tip) / (cy + r - tip) - 0.5;
    }
    pts
}

/// `path://` symbol: SVG path data -> flattened contours -> unit box (y up) -> triangles
/// (nonzero fill rule). `None` for a syntax error, a non-finite / huge number, no area, or more
/// than `MAX_PATH_EDGES` flattened edges.
fn path_triangles(d: &str) -> Option<Vec<[f32; 2]>> {
    let mut contours = parse_path(d)?;
    let (mut lo, mut hi) = ([f64::INFINITY; 2], [f64::NEG_INFINITY; 2]);
    for p in contours.iter().flatten() {
        lo = [lo[0].min(p[0]), lo[1].min(p[1])];
        hi = [hi[0].max(p[0]), hi[1].max(p[1])];
    }
    let (w, h) = (hi[0] - lo[0], hi[1] - lo[1]);
    if !(w > 0.0 && h > 0.0 && w.is_finite() && h.is_finite()) {
        return None;
    }
    let (cx, cy) = (0.5 * (lo[0] + hi[0]), 0.5 * (lo[1] + hi[1]));
    for p in contours.iter_mut().flatten() {
        // SVG y points down
        *p = [(p[0] - cx) / w, -(p[1] - cy) / h];
    }
    let tris = tessellate(&contours)?;
    (!tris.is_empty()).then_some(tris)
}

struct PathLexer<'a> {
    s: &'a [u8],
    i: usize,
}

impl PathLexer<'_> {
    fn skip(&mut self) {
        while self.i < self.s.len()
            && (self.s[self.i].is_ascii_whitespace() || self.s[self.i] == b',')
        {
            self.i += 1;
        }
    }

    fn peek(&mut self) -> Option<u8> {
        self.skip();
        self.s.get(self.i).copied()
    }

    fn number(&mut self) -> Option<f64> {
        self.skip();
        let (s, start) = (self.s, self.i);
        let mut i = start;
        if i < s.len() && (s[i] == b'+' || s[i] == b'-') {
            i += 1;
        }
        let int = i;
        while i < s.len() && s[i].is_ascii_digit() {
            i += 1;
        }
        let mut mantissa = i > int;
        if i < s.len() && s[i] == b'.' {
            i += 1;
            let frac = i;
            while i < s.len() && s[i].is_ascii_digit() {
                i += 1;
            }
            mantissa |= i > frac;
        }
        if !mantissa {
            return None;
        }
        if i < s.len() && (s[i] == b'e' || s[i] == b'E') {
            let mut j = i + 1;
            if j < s.len() && (s[j] == b'+' || s[j] == b'-') {
                j += 1;
            }
            let exp = j;
            while j < s.len() && s[j].is_ascii_digit() {
                j += 1;
            }
            if j > exp {
                i = j;
            }
        }
        let v: f64 = std::str::from_utf8(&s[start..i]).ok()?.parse().ok()?;
        self.i = i;
        // Coordinates must survive the f32 world transform
        (v.abs() < 1e30).then_some(v)
    }

    fn flag(&mut self) -> Option<bool> {
        self.skip();
        let f = match self.s.get(self.i)? {
            b'0' => false,
            b'1' => true,
            _ => return None,
        };
        self.i += 1;
        Some(f)
    }

    fn pair(&mut self, base: [f64; 2]) -> Option<[f64; 2]> {
        Some([self.number()? + base[0], self.number()? + base[1]])
    }
}

/// Flattened closed contours of SVG path data (M L H V C S Q T A Z, absolute and relative,
/// implicit command repeats).
fn parse_path(d: &str) -> Option<Vec<Vec<[f64; 2]>>> {
    const CUBIC_STEPS: usize = 16;
    const QUAD_STEPS: usize = 12;
    let mut lx = PathLexer {
        s: d.as_bytes(),
        i: 0,
    };
    let mut contours: Vec<Vec<[f64; 2]>> = Vec::new();
    let mut contour: Vec<[f64; 2]> = Vec::new();
    let (mut cur, mut start) = ([0.0f64; 2], [0.0f64; 2]);
    let (mut cubic_ctrl, mut quad_ctrl): (Option<[f64; 2]>, Option<[f64; 2]>) = (None, None);
    let mut last = 0u8;
    let mut points = 0usize;
    let flush = |contour: &mut Vec<[f64; 2]>, contours: &mut Vec<Vec<[f64; 2]>>| {
        let c = std::mem::take(contour);
        if c.len() >= 3 {
            contours.push(c);
        }
    };
    while let Some(c) = lx.peek() {
        let cmd = if c.is_ascii_alphabetic() {
            lx.i += 1;
            c
        } else {
            // Implicit repeat of the previous command (a moveto repeats as a lineto)
            match last {
                0 | b'Z' | b'z' => return None,
                b'M' => b'L',
                b'm' => b'l',
                x => x,
            }
        };
        if last == 0 && !matches!(cmd, b'M' | b'm') {
            return None;
        }
        let base = if cmd.is_ascii_lowercase() {
            cur
        } else {
            [0.0; 2]
        };
        let before = contour.len();
        let (mut next_cubic, mut next_quad) = (None, None);
        match cmd.to_ascii_uppercase() {
            b'M' => {
                let p = lx.pair(base)?;
                flush(&mut contour, &mut contours);
                contour.push(p);
                (cur, start) = (p, p);
            }
            b'L' => {
                cur = lx.pair(base)?;
                contour.push(cur);
            }
            b'H' => {
                cur = [lx.number()? + base[0], cur[1]];
                contour.push(cur);
            }
            b'V' => {
                cur = [cur[0], lx.number()? + base[1]];
                contour.push(cur);
            }
            b'C' | b'S' => {
                let c1 = if cmd.eq_ignore_ascii_case(&b'C') {
                    lx.pair(base)?
                } else {
                    cubic_ctrl.map_or(cur, |q| [2.0 * cur[0] - q[0], 2.0 * cur[1] - q[1]])
                };
                let c2 = lx.pair(base)?;
                let p = lx.pair(base)?;
                let p0 = cur;
                contour.extend((1..=CUBIC_STEPS).map(|k| {
                    let t = k as f64 / CUBIC_STEPS as f64;
                    let u = 1.0 - t;
                    let (a, b, c, e) = (u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t);
                    [
                        a * p0[0] + b * c1[0] + c * c2[0] + e * p[0],
                        a * p0[1] + b * c1[1] + c * c2[1] + e * p[1],
                    ]
                }));
                cur = p;
                next_cubic = Some(c2);
            }
            b'Q' | b'T' => {
                let c1 = if cmd.eq_ignore_ascii_case(&b'Q') {
                    lx.pair(base)?
                } else {
                    quad_ctrl.map_or(cur, |q| [2.0 * cur[0] - q[0], 2.0 * cur[1] - q[1]])
                };
                let p = lx.pair(base)?;
                let p0 = cur;
                contour.extend((1..=QUAD_STEPS).map(|k| {
                    let t = k as f64 / QUAD_STEPS as f64;
                    let u = 1.0 - t;
                    let (a, b, c) = (u * u, 2.0 * u * t, t * t);
                    [
                        a * p0[0] + b * c1[0] + c * p[0],
                        a * p0[1] + b * c1[1] + c * p[1],
                    ]
                }));
                cur = p;
                next_quad = Some(c1);
            }
            b'A' => {
                let (rx, ry, phi) = (lx.number()?, lx.number()?, lx.number()?);
                let (large, sweep) = (lx.flag()?, lx.flag()?);
                let p = lx.pair(base)?;
                arc(&mut contour, cur, [rx, ry], phi, large, sweep, p);
                cur = p;
            }
            b'Z' => {
                flush(&mut contour, &mut contours);
                cur = start;
                // A command after Z without a moveto starts at the closed subpath's start
                contour.push(start);
            }
            _ => return None,
        }
        (cubic_ctrl, quad_ctrl) = (next_cubic, next_quad);
        last = cmd;
        points += contour.len().saturating_sub(before);
        if points > MAX_PATH_EDGES {
            return None;
        }
    }
    flush(&mut contour, &mut contours);
    (!contours.is_empty()).then_some(contours)
}

/// SVG elliptical arc from `p0` to `p1` (endpoint -> center parameterization, SVG 1.1 F.6.5),
/// flattened into `out` (without `p0`).
fn arc(
    out: &mut Vec<[f64; 2]>,
    p0: [f64; 2],
    r: [f64; 2],
    phi_deg: f64,
    large: bool,
    sweep: bool,
    p1: [f64; 2],
) {
    use std::f64::consts::{PI, TAU};
    if p0 == p1 {
        return;
    }
    let (mut rx, mut ry) = (r[0].abs(), r[1].abs());
    if rx == 0.0 || ry == 0.0 {
        out.push(p1);
        return;
    }
    let (sin, cos) = phi_deg.to_radians().sin_cos();
    let (dx, dy) = (0.5 * (p0[0] - p1[0]), 0.5 * (p0[1] - p1[1]));
    let (x1, y1) = (cos * dx + sin * dy, -sin * dx + cos * dy);
    let lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
    if lambda > 1.0 {
        let s = lambda.sqrt();
        rx *= s;
        ry *= s;
    }
    let num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
    let den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
    let sign = if large == sweep { -1.0 } else { 1.0 };
    let coef = if den > 0.0 {
        (num / den).max(0.0).sqrt() * sign
    } else {
        0.0
    };
    let (cxp, cyp) = (coef * rx * y1 / ry, -coef * ry * x1 / rx);
    let (cx, cy) = (
        cos * cxp - sin * cyp + 0.5 * (p0[0] + p1[0]),
        sin * cxp + cos * cyp + 0.5 * (p0[1] + p1[1]),
    );
    let angle =
        |u: [f64; 2], v: [f64; 2]| (u[0] * v[1] - u[1] * v[0]).atan2(u[0] * v[0] + u[1] * v[1]);
    let u = [(x1 - cxp) / rx, (y1 - cyp) / ry];
    let v = [(-x1 - cxp) / rx, (-y1 - cyp) / ry];
    let theta = angle([1.0, 0.0], u);
    let mut delta = angle(u, v);
    if !sweep && delta > 0.0 {
        delta -= TAU;
    } else if sweep && delta < 0.0 {
        delta += TAU;
    }
    let n = ((delta.abs() / (PI / 32.0)).ceil() as usize).clamp(1, 256);
    for k in 1..n {
        let t = theta + delta * k as f64 / n as f64;
        let (s, c) = t.sin_cos();
        out.push([
            cx + rx * c * cos - ry * s * sin,
            cy + rx * c * sin + ry * s * cos,
        ]);
    }
    out.push(p1);
}

/// Triangles of closed contours under the nonzero fill rule: the plane is cut into horizontal
/// slabs at every vertex and edge crossing, and each slab's covered spans become trapezoids
/// (handles holes and self-intersections). `None` past `MAX_PATH_EDGES` / `MAX_PATH_CROSSINGS`.
fn tessellate(contours: &[Vec<[f64; 2]>]) -> Option<Vec<[f32; 2]>> {
    struct Edge {
        a: [f64; 2],
        b: [f64; 2],
        wind: i32,
    }
    impl Edge {
        fn x_at(&self, y: f64) -> f64 {
            self.a[0] + (y - self.a[1]) * (self.b[0] - self.a[0]) / (self.b[1] - self.a[1])
        }
    }
    let mut edges = Vec::new();
    for c in contours {
        for (i, &p) in c.iter().enumerate() {
            let q = c[(i + 1) % c.len()];
            if p[1] != q[1] {
                edges.push(if p[1] < q[1] {
                    Edge {
                        a: p,
                        b: q,
                        wind: 1,
                    }
                } else {
                    Edge {
                        a: q,
                        b: p,
                        wind: -1,
                    }
                });
            }
        }
    }
    if edges.len() > MAX_PATH_EDGES {
        return None;
    }
    let mut ys: Vec<f64> = edges.iter().flat_map(|e| [e.a[1], e.b[1]]).collect();
    let mut crossings = 0;
    for (i, e) in edges.iter().enumerate() {
        for f in &edges[i + 1..] {
            if e.b[1] <= f.a[1] || f.b[1] <= e.a[1] {
                continue;
            }
            let (r, s) = (
                [e.b[0] - e.a[0], e.b[1] - e.a[1]],
                [f.b[0] - f.a[0], f.b[1] - f.a[1]],
            );
            let den = r[0] * s[1] - r[1] * s[0];
            if den.abs() < 1e-18 {
                continue;
            }
            let d = [f.a[0] - e.a[0], f.a[1] - e.a[1]];
            let (t, u) = (
                (d[0] * s[1] - d[1] * s[0]) / den,
                (d[0] * r[1] - d[1] * r[0]) / den,
            );
            if t > 0.0 && t < 1.0 && u > 0.0 && u < 1.0 {
                crossings += 1;
                if crossings > MAX_PATH_CROSSINGS {
                    return None;
                }
                ys.push(e.a[1] + t * r[1]);
            }
        }
    }
    ys.sort_by(f64::total_cmp);
    ys.dedup_by(|a, b| (*a - *b).abs() < 1e-12);
    let mut out = Vec::new();
    let mut active: Vec<(f64, f64, f64, i32)> = Vec::new();
    for w in ys.windows(2) {
        let (ya, yb) = (w[0], w[1]);
        let ym = 0.5 * (ya + yb);
        active.clear();
        active.extend(
            edges
                .iter()
                .filter(|e| e.a[1] <= ym && e.b[1] >= ym)
                .map(|e| (e.x_at(ym), e.x_at(ya), e.x_at(yb), e.wind)),
        );
        active.sort_by(|p, q| p.0.total_cmp(&q.0));
        let mut wind = 0;
        for k in 0..active.len().saturating_sub(1) {
            wind += active[k].3;
            if wind == 0 {
                continue;
            }
            let (l, r) = (active[k], active[k + 1]);
            let quad = [[l.1, ya], [r.1, ya], [r.2, yb], [l.2, yb]];
            for t in [[quad[0], quad[1], quad[2]], [quad[0], quad[2], quad[3]]] {
                let area = (t[1][0] - t[0][0]) * (t[2][1] - t[0][1])
                    - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1]);
                if area.abs() > 1e-14 {
                    out.extend(t.map(|p| [p[0] as f32, p[1] as f32]));
                }
            }
        }
    }
    Some(out)
}

/// ECharts repeat layout along the value axis (CSS px): `(times, margin)` for a run of symbols
/// of `unit` length filling `bound`, cut at `cut` (the bar length) unless `Fixed` / `Times`.
/// The margin is re-spread so the run spans the bound exactly.
pub(crate) fn repeat_layout(
    bound: f32,
    cut: f32,
    unit: f32,
    margin: f32,
    end_gap: bool,
    repeat: Repeat,
) -> (u32, f32) {
    let to_int = |x: f32| {
        let r = x.round();
        if (x - r).abs() < 1e-4 {
            r
        } else {
            x.ceil()
        }
    };
    let (bound, cut) = (bound.abs(), cut.abs());
    let max = MAX_PICTORIAL_REPEAT as f32;
    let step = unit + 2.0 * margin;
    if ![bound, cut, unit, margin].iter().all(|v| v.is_finite()) || !(unit > 0.0) || !(step > 1e-3)
    {
        return (0, 0.0);
    }
    let end_fix = if end_gap { 0.0 } else { 2.0 * margin };
    let mut times = match repeat {
        Repeat::Times(t) => t as f32,
        _ => to_int((bound + end_fix) / step),
    }
    .clamp(0.0, max);
    let slots = if end_gap {
        times
    } else {
        (times - 1.0).max(1.0)
    };
    let m = if slots > 0.0 {
        (bound - times * unit) / 2.0 / slots
    } else {
        margin
    };
    if repeat == Repeat::Auto {
        let step = unit + 2.0 * m;
        let end_fix = if end_gap { 0.0 } else { 2.0 * m };
        times = if cut > 0.0 && step > 1e-3 {
            to_int((cut + end_fix) / step).clamp(0.0, max)
        } else {
            0.0
        };
    }
    (times as u32, m)
}

impl PictorialSpec {
    /// One `PICTORIAL_STRIDE` record: `[symbol, repeat (0 off / 1 auto / 2 fixed / 3 count),
    /// count, width, width %, height, height %, margin, margin %, end gap, clip, position (0 start
    /// / 1 end / 2 center), offset x, x %, offset y, y %, rotate°, bounding lo, bounding hi]`
    /// (flags 0 / 1, percents as 0..100, bounding NaN NaN = none).
    fn from_record(r: &[f32], symbols: usize) -> Option<Self> {
        let int = |v: f32, max: usize| {
            (v.is_finite() && v >= 0.0 && v.fract() == 0.0 && v <= max as f32).then_some(v as usize)
        };
        let flag = |v: f32| (v == 0.0 || v == 1.0).then_some(v == 1.0);
        let dim = |v: f32, pct: f32| {
            if v.is_finite() {
                flag(pct).map(|pct| Dim { v, pct })
            } else {
                None
            }
        };
        let symbol = int(r[0], symbols.checked_sub(1)?)?;
        let repeat = match int(r[1], 3)? {
            0 => Repeat::Off,
            1 => Repeat::Auto,
            2 => Repeat::Fixed,
            _ => Repeat::Times(int(r[2], MAX_PICTORIAL_REPEAT as usize)? as u32),
        };
        let size = [dim(r[3], r[4])?, dim(r[5], r[6])?];
        if size.iter().any(|d| d.v < 0.0) {
            return None;
        }
        let position = match int(r[11], 2)? {
            0 => SymbolPosition::Start,
            1 => SymbolPosition::End,
            _ => SymbolPosition::Center,
        };
        let bounding = match (r[17], r[18]) {
            (a, b) if a.is_nan() && b.is_nan() => None,
            (a, b) if a.is_finite() && b.is_finite() => Some((a.min(b), a.max(b))),
            _ => return None,
        };
        Some(Self {
            symbol,
            repeat,
            size,
            margin: dim(r[7], r[8])?,
            end_gap: flag(r[9])?,
            clip: flag(r[10])?,
            position,
            offset: [dim(r[12], r[13])?, dim(r[14], r[15])?],
            rotate_deg: r[16].is_finite().then_some(r[16])?,
            bounding,
        })
    }
}

/// Pictorial fill triangles of the bars `segs` (the chart's, or an animation frame's):
/// `wpp` = world units per CSS px; the hovered bar is lightened, non-emphasized series dimmed.
pub(crate) fn build_pictorial(
    b: &BarChart,
    segs: &[Option<BarSeg>],
    wpp: f32,
    hovered: Option<usize>,
    style: &ChartHoverStyle,
    out: &mut Vec<ChartFillRaw>,
) {
    out.clear();
    let Some(p) = &b.pictorial else { return };
    if !(wpp.is_finite() && wpp > 0.0) || b.layout.view != ChartViewMode::Flat {
        return;
    }
    let n = b.categories.max(1);
    for (g, seg) in segs.iter().enumerate() {
        let (Some(seg), Some(spec)) = (seg, p.specs.get(g)) else {
            continue;
        };
        let Some(shape) = p.shapes.get(spec.symbol).filter(|s| !s.is_empty()) else {
            continue;
        };
        let mut color = if hovered == Some(g) {
            b.hover_color(g, style)
        } else {
            b.color_of(g)
        };
        if b.emphasis.is_some_and(|e| e != g / n) {
            color[3] *= DIMMED_SERIES_ALPHA;
        }
        place_symbols(b, seg, spec, shape, color, wpp, out);
        if out.len() >= MAX_PICTORIAL_VERTICES {
            out.truncate(MAX_PICTORIAL_VERTICES - MAX_PICTORIAL_VERTICES % 3);
            break;
        }
    }
}

/// Symbols of one bar (ECharts `pictorialBar` layout, in CSS px along the bar).
fn place_symbols(
    b: &BarChart,
    seg: &BarSeg,
    spec: &PictorialSpec,
    shape: &[[f32; 2]],
    color: [f32; 4],
    wpp: f32,
    out: &mut Vec<ChartFillRaw>,
) {
    let horizontal = b.horizontal();
    let cat_px = (seg.x1 - seg.x0).abs() / wpp;
    let len = (seg.y1 - seg.y0) / wpp;
    let up = len >= 0.0;
    let repeat = spec.repeat != Repeat::Off;
    // Bounding length: the data bounds, the plot edge (repeats) or the bar itself
    let bound = match spec.bounding {
        Some((neg, pos)) => (b.zero_y + if up { pos } else { neg } * b.scale - seg.y0) / wpp,
        None if repeat => {
            let edge = if up {
                b.bottom + b.axis_lengths().1
            } else {
                b.bottom
            };
            (edge - seg.y0) / wpp
        }
        None => len,
    };
    let sign = if bound > 0.0 || (bound == 0.0 && up) {
        1.0
    } else {
        -1.0
    };
    // Screen [width, height]: the category axis is x for vertical bars, y for horizontal ones
    let (ci, vi) = if horizontal { (1, 0) } else { (0, 1) };
    let mut size = [0.0f32; 2];
    size[ci] = spec.size[ci].of(cat_px).abs();
    size[vi] = spec.size[vi]
        .of(if repeat { cat_px } else { bound.abs() })
        .abs();
    if !size.iter().all(|s| s.is_finite() && *s > 0.0) || !bound.is_finite() {
        return;
    }
    let unit = size[vi];
    let (times, margin) = if repeat {
        repeat_layout(
            bound,
            len,
            unit,
            spec.margin.of(unit),
            spec.end_gap,
            spec.repeat,
        )
    } else {
        (1, 0.0)
    };
    if times == 0 {
        return;
    }
    let step = unit + 2.0 * margin;
    let path_len = if repeat {
        times as f32 * step - if spec.end_gap { 0.0 } else { 2.0 * margin }
    } else {
        unit
    };
    let pos = match spec.position {
        SymbolPosition::Start => sign * path_len * 0.5,
        SymbolPosition::End => bound - sign * path_len * 0.5,
        SymbolPosition::Center => bound * 0.5,
    };
    // Screen offset (y down) in world units
    let offset = [
        spec.offset[0].of(size[0]) * wpp,
        -spec.offset[1].of(size[1]) * wpp,
    ];
    let (sin, cos) = spec.rotate_deg.to_radians().sin_cos();
    // Negative bars mirror the symbol along the value axis
    let mirror = match (sign < 0.0, horizontal) {
        (true, true) => [-1.0, 1.0],
        (true, false) => [1.0, -1.0],
        _ => [1.0, 1.0],
    };
    let scale = [size[0] * wpp * mirror[0], size[1] * wpp * mirror[1]];
    let clip = spec.clip.then(|| (seg.y0.min(seg.y1), seg.y0.max(seg.y1)));
    let axis = if horizontal { 0 } else { 1 };
    let mid = 0.5 * (seg.x0 + seg.x1);
    let (mut poly, mut scratch) = (Vec::with_capacity(8), Vec::with_capacity(8));
    for i in 0..times {
        // The chart cap (build_pictorial truncates) bounds one bar's work and memory too
        if out.len() >= MAX_PICTORIAL_VERTICES {
            return;
        }
        let v = pos + step * (i as f32 - times as f32 * 0.5 + 0.5);
        let (wx, wy) = b.world(mid, seg.y0 + v * wpp);
        let center = [wx + offset[0], wy + offset[1]];
        for t in shape.chunks_exact(3) {
            poly.clear();
            poly.extend(t.iter().map(|&[ux, uy]| {
                let (px, py) = (ux * scale[0], uy * scale[1]);
                [
                    center[0] + px * cos - py * sin,
                    center[1] + px * sin + py * cos,
                ]
            }));
            if let Some((lo, hi)) = clip {
                clip_slab(&mut poly, &mut scratch, axis, lo, hi);
            }
            if poly.len() < 3 || !poly.iter().flatten().all(|c| c.is_finite()) {
                continue;
            }
            let vertex = |p: [f32; 2]| ChartFillRaw {
                position: [p[0], p[1], 0.0, 0.0],
                color,
            };
            for k in 1..poly.len() - 1 {
                out.extend([vertex(poly[0]), vertex(poly[k]), vertex(poly[k + 1])]);
            }
        }
    }
}

/// Clips a convex polygon to `lo <= p[axis] <= hi` (Sutherland-Hodgman); empty when outside.
fn clip_slab(poly: &mut Vec<[f32; 2]>, scratch: &mut Vec<[f32; 2]>, axis: usize, lo: f32, hi: f32) {
    for (edge, keep_above) in [(lo, true), (hi, false)] {
        let inside = |p: &[f32; 2]| {
            if keep_above {
                p[axis] >= edge
            } else {
                p[axis] <= edge
            }
        };
        scratch.clear();
        for i in 0..poly.len() {
            let (a, b) = (poly[i], poly[(i + 1) % poly.len()]);
            let (ia, ib) = (inside(&a), inside(&b));
            if ia {
                scratch.push(a);
            }
            if ia != ib {
                let t = (edge - a[axis]) / (b[axis] - a[axis]);
                scratch.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
            }
        }
        std::mem::swap(poly, scratch);
        if poly.len() < 3 {
            poly.clear();
            return;
        }
    }
}

/// World units per CSS px of a flat view.
fn world_per_px(view: &ChartView) -> Option<f32> {
    let a = view.project_css(Vec3::ZERO)?;
    let b = view.project_css(Vec3::X)?;
    let d = (b.0 - a.0).hypot(b.1 - a.1);
    (d.is_finite() && d > 1e-6).then(|| 1.0 / d)
}

/// Bar segments an animation snapshot keeps for a pictorial chart (empty otherwise).
pub(crate) fn pictorial_segs(kind: &ChartKind) -> Vec<Option<BarSeg>> {
    match kind {
        ChartKind::Bar(b) if b.pictorial.is_some() => b.segs.clone(),
        _ => Vec::new(),
    }
}

/// The pictorial chart `kind` can tween from the snapshot segments `from`.
pub(crate) fn pictorial_matches(kind: &ChartKind, from: &[Option<BarSeg>]) -> bool {
    matches!(kind, ChartKind::Bar(b) if b.pictorial.is_some() && !from.is_empty() && from.len() == b.segs.len())
}

/// Segments of an update frame: `from` -> the chart's at `e` (new bars grow from their base).
pub(crate) fn pictorial_tween(
    kind: &ChartKind,
    from: &[Option<BarSeg>],
    e: f32,
) -> Option<Vec<Option<BarSeg>>> {
    let ChartKind::Bar(b) = kind else { return None };
    if !pictorial_matches(kind, from) {
        return None;
    }
    let lerp = |a: f32, c: f32| a + (c - a) * e;
    Some(
        from.iter()
            .zip(&b.segs)
            .map(|(f, t)| match (f, t) {
                (Some(f), Some(t)) => Some(BarSeg {
                    x0: lerp(f.x0, t.x0),
                    x1: lerp(f.x1, t.x1),
                    y0: lerp(f.y0, t.y0),
                    y1: lerp(f.y1, t.y1),
                    outer: t.outer,
                }),
                (None, Some(t)) => Some(BarSeg {
                    y1: lerp(t.y0, t.y1),
                    ..*t
                }),
                _ => None,
            })
            .collect(),
    )
}

/// Segments of an enter frame: every bar grown to `e` of its length from its base.
pub(crate) fn pictorial_grow(kind: &ChartKind, e: f32) -> Option<Vec<Option<BarSeg>>> {
    match kind {
        ChartKind::Bar(b) if b.pictorial.is_some() => Some(
            b.segs
                .iter()
                .map(|s| {
                    s.map(|s| BarSeg {
                        y1: s.y0 + (s.y1 - s.y0) * e,
                        ..s
                    })
                })
                .collect(),
        ),
        _ => None,
    }
}

/// Symbols of animation-frame segments into `out`; false when the chart has no built pictorial
/// layer (the generic fill animation applies).
pub(crate) fn pictorial_frame(
    kind: &ChartKind,
    hovered: Option<usize>,
    style: &ChartHoverStyle,
    segs: &[Option<BarSeg>],
    out: &mut Vec<ChartFillRaw>,
) -> bool {
    let ChartKind::Bar(b) = kind else {
        return false;
    };
    let Some(wpp) = b.pictorial.as_ref().and_then(|p| p.built_wpp) else {
        return false;
    };
    build_pictorial(b, segs, wpp, hovered, style, out);
    true
}

impl ChartState {
    /// Turns the current 2D bar chart into a pictorial one. `symbols`: `\n`-separated symbol
    /// list; `records`: `PICTORIAL_STRIDE` floats per bar id. Returns false (nothing changes) for
    /// invalid input, 3D bars, histograms, or another chart kind.
    pub fn set_bar_pictorial(&mut self, symbols: &str, records: &[f32]) -> bool {
        let ChartKind::Bar(b) = &mut self.kind else {
            return false;
        };
        if b.layout.view != ChartViewMode::Flat || b.histogram.is_some() || b.values.is_empty() {
            return false;
        }
        if records.len() != b.values.len() * PICTORIAL_STRIDE {
            return false;
        }
        let Some(shapes) = symbols
            .split('\n')
            .map(symbol_triangles)
            .collect::<Option<Vec<_>>>()
        else {
            return false;
        };
        let specs = records
            .chunks_exact(PICTORIAL_STRIDE)
            .map(|r| PictorialSpec::from_record(r, shapes.len()));
        let Some(specs) = specs.collect::<Option<Vec<_>>>() else {
            return false;
        };
        b.pictorial = Some(Pictorial {
            shapes,
            specs,
            built_wpp: None,
        });
        self.dirty.bars = true;
        self.dirty.fills = true;
        true
    }

    /// Rebuilds the symbols when the bars or the screen scale changed (`prepare_layers`).
    pub(crate) fn prepare_pictorial(&mut self, view: &ChartView) {
        let hovered = hovered_bar(self.hover.as_ref());
        let ChartKind::Bar(b) = &mut self.kind else {
            return;
        };
        let Some(built) = b.pictorial.as_ref().map(|p| p.built_wpp) else {
            return;
        };
        let Some(wpp) = world_per_px(view) else {
            return;
        };
        if self.dirty.bars || built.is_none_or(|w| ((w - wpp) / wpp).abs() > 1e-4) {
            build_pictorial(b, &b.segs, wpp, hovered, &self.hover_style, &mut self.fills);
            if let Some(p) = &mut b.pictorial {
                p.built_wpp = Some(wpp);
            }
            self.dirty.fills = true;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chart::animation::{AnimationOptions, Easing};
    use crate::chart::bar_style::{BarOrientation, BarStyle};
    use crate::scene::SceneWorld;

    const NAN: f32 = f32::NAN;
    /// Stretched symbol 0, 100% x 100%, margin 15%, start, no clip / offset / rotation / bounds
    const BASE: [f32; PICTORIAL_STRIDE] = [
        0.0, 0.0, 0.0, 100.0, 1.0, 100.0, 1.0, 15.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
        NAN, NAN,
    ];

    fn rec(edit: impl Fn(&mut [f32; PICTORIAL_STRIDE])) -> [f32; PICTORIAL_STRIDE] {
        let mut r = BASE;
        edit(&mut r);
        r
    }

    fn records(n: usize, r: [f32; PICTORIAL_STRIDE]) -> Vec<f32> {
        (0..n).flat_map(|_| r).collect()
    }

    fn area(tris: &[[f32; 2]]) -> f32 {
        tris.chunks(3)
            .map(|t| {
                0.5 * ((t[1][0] - t[0][0]) * (t[2][1] - t[0][1])
                    - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1]))
                    .abs()
            })
            .sum()
    }

    fn bbox(pts: impl Iterator<Item = [f32; 2]>) -> [f32; 4] {
        pts.fold(
            [
                f32::INFINITY,
                f32::INFINITY,
                f32::NEG_INFINITY,
                f32::NEG_INFINITY,
            ],
            |b, p| {
                [
                    b[0].min(p[0]),
                    b[1].min(p[1]),
                    b[2].max(p[0]),
                    b[3].max(p[1]),
                ]
            },
        )
    }

    fn close(a: [f32; 4], b: [f32; 4], eps: f32) -> bool {
        a.iter().zip(&b).all(|(x, y)| (x - y).abs() <= eps)
    }

    fn camera() -> OrbitCamera {
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

    fn chart(values: Vec<f32>, horizontal: bool, cam: &mut OrbitCamera) -> ChartState {
        let mut scene = SceneWorld::new();
        let mut st = ChartState::new_bar(
            values,
            vec![[0.2, 0.4, 0.8, 1.0]],
            BarLayout {
                width: 160.0,
                max_height: 80.0,
                bar_width: 0.0,
                corner_radius_px: 0.0,
                view: ChartViewMode::Flat,
            },
            &mut scene,
        );
        if horizontal {
            assert!(st.set_bar_style(BarStyle {
                orientation: BarOrientation::Horizontal,
                ..BarStyle::default()
            }));
        }
        st.frame_camera(cam, (1600.0, 900.0));
        st
    }

    fn bar(st: &ChartState) -> &BarChart {
        match &st.kind {
            ChartKind::Bar(b) => b,
            _ => unreachable!(),
        }
    }

    fn wpp(cam: &OrbitCamera) -> f32 {
        let v = view(cam);
        let a = v.project_css(Vec3::ZERO).unwrap();
        let b = v.project_css(Vec3::new(1.0, 0.0, 0.0)).unwrap();
        1.0 / (b.0 - a.0)
    }

    /// World rect `[x0, y0, x1, y1]` of bar `g`.
    fn bar_world(st: &ChartState, g: usize) -> [f32; 4] {
        let b = bar(st);
        b.bar_rect(&b.segs[g].unwrap()).0
    }

    /// World bboxes of the fill triangles, split by vertex color run (one per bar in the tests:
    /// bars alternate colors through `color_of` only with several colors, so split by position).
    fn fills_of(st: &mut ChartState, cam: &OrbitCamera) -> Vec<ChartFillRaw> {
        st.prepare_layers(&view(cam))
            .fills
            .map(<[ChartFillRaw]>::to_vec)
            .unwrap_or_default()
    }

    fn within(fills: &[ChartFillRaw], rect: [f32; 4]) -> Vec<[f32; 2]> {
        let eps = 1e-3;
        fills
            .chunks(3)
            .filter(|t| {
                let c = [
                    (t[0].position[0] + t[1].position[0] + t[2].position[0]) / 3.0,
                    (t[0].position[1] + t[1].position[1] + t[2].position[1]) / 3.0,
                ];
                c[0] >= rect[0] - eps
                    && c[0] <= rect[2] + eps
                    && c[1] >= rect[1] - eps
                    && c[1] <= rect[3] + eps
            })
            .flatten()
            .map(|f| [f.position[0], f.position[1]])
            .collect()
    }

    #[test]
    fn built_in_symbols_fill_their_unit_box() {
        let full = [-0.5, -0.5, 0.5, 0.5];
        for (name, want) in [
            ("rect", 1.0),
            ("square", 1.0),
            ("triangle", 0.5),
            ("diamond", 0.5),
            ("circle", std::f32::consts::FRAC_PI_4),
        ] {
            let t = symbol_triangles(name).unwrap_or_else(|| panic!("{name}"));
            assert!(
                (area(&t) - want).abs() < want * 0.01,
                "{name}: {}",
                area(&t)
            );
            assert!(
                close(bbox(t.iter().copied()), full, 1e-4),
                "{name} spans the box"
            );
        }
        let round = area(&symbol_triangles("roundRect").unwrap());
        assert!(round > 0.95 && round < 1.0, "roundRect {round}");
        for name in ["pin", "arrow"] {
            let t = symbol_triangles(name).unwrap();
            assert!(
                area(&t) > 0.3 && close(bbox(t.iter().copied()), full, 1e-3),
                "{name}"
            );
        }
        // Triangle apex at the top
        let tri = symbol_triangles("triangle").unwrap();
        let top =
            tri.iter().copied().fold(
                [0.0, f32::NEG_INFINITY],
                |a, p| if p[1] > a[1] { p } else { a },
            );
        assert!(top[0].abs() < 1e-5 && (top[1] - 0.5).abs() < 1e-5);
        assert_eq!(symbol_triangles("none"), Some(Vec::new()));
        assert_eq!(symbol_triangles("star"), None);
        assert!(!pictorial_symbol_valid("image://a.png"));
    }

    #[test]
    fn one_bar_stops_emitting_at_the_vertex_cap() {
        let mut cam = camera();
        let st = chart(vec![10.0], false, &mut cam);
        let w = wpp(&cam);
        let b = bar(&st);
        // 3000-vertex symbol x 1000 repeats = 3M vertices without the cap
        let shape: Vec<[f32; 2]> = (0..1000)
            .flat_map(|_| [[-0.5, -0.5], [0.5, -0.5], [0.0, 0.5]])
            .collect();
        let spec = PictorialSpec::from_record(
            &rec(|r| {
                r[1] = 3.0;
                r[2] = 1000.0;
            }),
            1,
        )
        .unwrap();
        let mut out = Vec::new();
        place_symbols(b, &b.segs[0].unwrap(), &spec, &shape, [1.0; 4], w, &mut out);
        assert!(
            out.len() <= MAX_PICTORIAL_VERTICES + shape.len(),
            "{} vertices",
            out.len()
        );
    }

    #[test]
    fn dense_self_crossing_paths_are_rejected_quickly() {
        use std::fmt::Write as _;
        // Star polygon {401/200}: ~80k edge crossings would make ~80k slabs over 401 edges
        let n = 401;
        let mut d = String::from("path://");
        for i in 0..n {
            let t = std::f64::consts::TAU * ((i * 200) % n) as f64 / n as f64;
            let _ = write!(
                d,
                "{}{:.4} {:.4} ",
                if i == 0 { 'M' } else { 'L' },
                50.0 + 50.0 * t.cos(),
                50.0 + 50.0 * t.sin()
            );
        }
        d.push('Z');
        let start = std::time::Instant::now();
        assert!(!pictorial_symbol_valid(&d), "too many crossings");
        assert!(
            start.elapsed() < std::time::Duration::from_millis(500),
            "{:?}",
            start.elapsed()
        );
        // A self-crossing star with few crossings still tessellates
        assert!(pictorial_symbol_valid(
            "path://M50 0 L79 91 L2 35 L98 35 L21 91 Z"
        ));
    }

    #[test]
    fn svg_paths_parse_holes_curves_arcs_and_relative_commands() {
        let p = |s: &str| symbol_triangles(&format!("path://{s}")).unwrap_or_else(|| panic!("{s}"));
        // Opposite-winding hole (nonzero rule): 1 - 0.6²
        assert!((area(&p("M0,0H10V10H0Z M2,2V8H8V2Z")) - 0.64).abs() < 1e-4);
        // Same winding: no hole
        assert!((area(&p("m0 0h10v10h-10z m2 2h6v6h-6z")) - 1.0).abs() < 1e-4);
        // Two arcs: a circle
        let circle = area(&p("M0,5 A5,5 0 1,1 10,5 A5,5 0 1,1 0,5Z"));
        assert!(
            (circle - std::f32::consts::FRAC_PI_4).abs() < 0.01,
            "{circle}"
        );
        // Self-intersecting bow tie
        assert!((area(&p("M0,0 L10,10 L10,0 L0,10 Z")) - 0.5).abs() < 1e-4);
        // SVG y points down: the apex at y = 0 is the symbol's top
        let tri = p("M5,0 L10,10 L0,10 Z");
        let top =
            tri.iter().copied().fold(
                [0.0, f32::NEG_INFINITY],
                |a, q| if q[1] > a[1] { q } else { a },
            );
        assert!(top[0].abs() < 1e-4 && (top[1] - 0.5).abs() < 1e-4);
        // Curves stay inside the box and fill part of it; implicit repeats and compact numbers
        let c = p("M0 0C0 10 10 10 10 0zM0-5q5 5 10 0t10 0 s5-5 0-5");
        assert!(area(&c) > 0.1 && close(bbox(c.iter().copied()), [-0.5, -0.5, 0.5, 0.5], 1e-4));
        assert!(
            (area(&p("M0,0 10,0 10,10 0,10z")) - 1.0).abs() < 1e-4,
            "implicit lineto after M"
        );
    }

    #[test]
    fn invalid_paths_and_symbols_are_rejected() {
        for s in [
            "path://",
            "path://M0,0 L",
            "path://Q1",
            "path://M0,0 L10,0",
            "path://M0 0 X 1 2",
            "path://L1,1 2,2 0,3",
            "path://M0,0 L1e40,0 L0,1Z",
            "Circle",
            "",
        ] {
            assert!(!pictorial_symbol_valid(s), "{s:?}");
        }
        assert!(pictorial_symbol_valid("path://M0,0 L1,0 L0,1Z"));
    }

    #[test]
    fn repeat_layout_follows_echarts() {
        // 106 / 26 -> 5 symbols; the margin shrinks to fill the bound exactly
        let (t, m) = repeat_layout(100.0, 100.0, 20.0, 3.0, false, Repeat::Auto);
        assert_eq!(t, 5);
        assert!(m.abs() < 1e-5);
        // Auto cuts at the bar length: ceil(50 / 20)
        assert_eq!(
            repeat_layout(100.0, 50.0, 20.0, 3.0, false, Repeat::Auto).0,
            3
        );
        // Fixed ignores the bar length
        assert_eq!(
            repeat_layout(100.0, 50.0, 20.0, 3.0, false, Repeat::Fixed).0,
            5
        );
        // A count spreads its symbols over the bound: (100 - 60) / 2 / 2
        let (t, m) = repeat_layout(100.0, 50.0, 20.0, 3.0, false, Repeat::Times(3));
        assert_eq!(t, 3);
        assert!((m - 10.0).abs() < 1e-4);
        // End gaps: (100 - 80) / 2 / 4
        let (t, m) = repeat_layout(100.0, 100.0, 20.0, 0.0, true, Repeat::Times(4));
        assert_eq!(t, 4);
        assert!((m - 2.5).abs() < 1e-4);
        // Degenerate inputs never loop / divide by zero
        assert_eq!(
            repeat_layout(100.0, 100.0, 0.0, 0.0, false, Repeat::Auto).0,
            0
        );
        assert_eq!(repeat_layout(0.0, 0.0, 20.0, 3.0, true, Repeat::Auto).0, 0);
        assert!(repeat_layout(1e9, 1e9, 1.0, 0.0, false, Repeat::Auto).0 <= MAX_PICTORIAL_REPEAT);
    }

    #[test]
    fn set_bar_pictorial_validates_before_replacing_the_bars() {
        let mut cam = camera();
        let mut st = chart(vec![10.0, 20.0, -5.0], false, &mut cam);
        let good = records(3, BASE);
        assert!(
            !st.set_bar_pictorial("rect", &good[..PICTORIAL_STRIDE * 2]),
            "record count"
        );
        assert!(!st.set_bar_pictorial("rect\npath://M0", &good), "bad path");
        assert!(
            !st.set_bar_pictorial("rect", &records(3, rec(|r| r[0] = 1.0))),
            "symbol index"
        );
        assert!(
            !st.set_bar_pictorial("rect", &records(3, rec(|r| r[3] = NAN))),
            "size"
        );
        assert!(
            !st.set_bar_pictorial("rect", &records(3, rec(|r| r[1] = 7.0))),
            "repeat mode"
        );
        assert!(
            !st.set_bar_pictorial("rect", &records(3, rec(|r| r[17] = 1.0))),
            "half a bounding pair"
        );
        assert!(bar(&st).pictorial.is_none());
        assert_eq!(
            st.prepare_layers(&view(&cam)).bars.map(<[_]>::len),
            Some(3),
            "plain bars kept"
        );

        assert!(st.set_bar_pictorial("rect", &good));
        let layers = st.prepare_layers(&view(&cam));
        assert_eq!(
            layers.bars.map(<[_]>::len),
            Some(0),
            "the symbols replace the bars"
        );
        assert_eq!(
            layers.fills.map(<[_]>::len),
            Some(3 * 6),
            "one rect (2 triangles) per bar"
        );

        // 3D bars refuse
        let mut scene = SceneWorld::new();
        let mut depth = ChartState::new_bar(
            vec![1.0],
            vec![[1.0; 4]],
            BarLayout {
                width: 160.0,
                max_height: 80.0,
                bar_width: 0.0,
                corner_radius_px: 0.0,
                view: ChartViewMode::Depth,
            },
            &mut scene,
        );
        assert!(!depth.set_bar_pictorial("rect", &records(1, BASE)));
    }

    #[test]
    fn background_tracks_stay_as_the_shadow_bars() {
        let mut cam = camera();
        let mut st = chart(vec![10.0, 20.0], false, &mut cam);
        assert!(st.set_bar_background(Some([0.5, 0.5, 0.5, 0.2])));
        assert!(st.set_bar_pictorial("circle", &records(2, BASE)));
        let layers = st.prepare_layers(&view(&cam));
        assert_eq!(layers.bars.map(<[_]>::len), Some(2), "tracks only");
    }

    #[test]
    fn a_stretched_symbol_covers_its_bar_both_ways() {
        let mut cam = camera();
        for horizontal in [false, true] {
            let mut st = chart(vec![10.0, 20.0, -5.0], horizontal, &mut cam);
            assert!(st.set_bar_pictorial("rect", &records(3, BASE)));
            let fills = fills_of(&mut st, &cam);
            for g in 0..3 {
                let rect = bar_world(&st, g);
                let got = bbox(within(&fills, rect).into_iter());
                assert!(
                    close(got, rect, 1e-3),
                    "horizontal {horizontal} bar {g}: {got:?} vs {rect:?}"
                );
            }
        }
    }

    #[test]
    fn negative_bars_mirror_the_symbol() {
        let mut cam = camera();
        let mut st = chart(vec![10.0, -10.0], false, &mut cam);
        assert!(st.set_bar_pictorial("triangle", &records(2, BASE)));
        let fills = fills_of(&mut st, &cam);
        let (up, down) = (bar_world(&st, 0), bar_world(&st, 1));
        let apex = |pts: Vec<[f32; 2]>, top: bool| {
            pts.into_iter().fold(
                [
                    0.0,
                    if top {
                        f32::NEG_INFINITY
                    } else {
                        f32::INFINITY
                    },
                ],
                |a, p| {
                    if (top && p[1] > a[1]) || (!top && p[1] < a[1]) {
                        p
                    } else {
                        a
                    }
                },
            )
        };
        let a = apex(within(&fills, up), true);
        assert!(
            (a[0] - 0.5 * (up[0] + up[2])).abs() < 1e-3,
            "positive bar: apex up, centered"
        );
        let a = apex(within(&fills, down), false);
        assert!(
            (a[0] - 0.5 * (down[0] + down[2])).abs() < 1e-3,
            "negative bar: apex down, centered"
        );
    }

    #[test]
    fn repeated_symbols_clip_at_the_value() {
        let mut cam = camera();
        // 20 px tall rects repeated along the bar
        let repeated = rec(|r| {
            r[1] = 1.0;
            r[5] = 20.0;
            r[6] = 0.0;
        });
        let mut st = chart(vec![13.0, 20.0], false, &mut cam);
        let w = wpp(&cam);
        assert!(st.set_bar_pictorial("rect", &records(2, repeated)));
        let fills = fills_of(&mut st, &cam);
        let rect = bar_world(&st, 0);
        let column = [rect[0], rect[1], rect[2], rect[3] + 100.0];
        let top = bbox(within(&fills, column).into_iter())[3];
        assert!(
            top > rect[3] + 1e-3,
            "unclipped: the last symbol passes the value"
        );
        assert!(top - rect[3] < 26.0 * w, "by less than one symbol step");

        let mut st = chart(vec![13.0, 20.0], false, &mut cam);
        assert!(st.set_bar_pictorial(
            "rect",
            &records(
                2,
                rec(|r| {
                    *r = repeated;
                    r[10] = 1.0;
                })
            )
        ));
        let fills = fills_of(&mut st, &cam);
        let got = bbox(within(&fills, column).into_iter());
        assert!(
            (got[3] - rect[3]).abs() < 1e-3,
            "clipped at the value: {} vs {}",
            got[3],
            rect[3]
        );
        assert!((got[1] - rect[1]).abs() < 1e-3, "from the base");
    }

    #[test]
    fn fixed_repeat_with_bounding_data_keeps_its_symbol_count() {
        let mut cam = camera();
        // Bounding 0..40: fixed symbols up to the 40 line whatever the value, clipped at it
        let r = rec(|r| {
            r[1] = 2.0;
            r[5] = 10.0;
            r[6] = 0.0;
            r[7] = 0.0;
            r[8] = 0.0;
            r[10] = 1.0;
            r[17] = 0.0;
            r[18] = 40.0;
        });
        let counts: Vec<usize> = [10.0, 30.0]
            .into_iter()
            .map(|v| {
                let mut st = chart(vec![v, 40.0], false, &mut cam);
                assert!(st.set_bar_pictorial(
                    "diamond",
                    &records(
                        2,
                        rec(|x| {
                            *x = r;
                            x[10] = 0.0;
                        })
                    )
                ));
                let f = fills_of(&mut st, &cam);
                let r0 = bar_world(&st, 0);
                within(&f, [r0[0], r0[1], r0[2], r0[1] + 1000.0]).len()
            })
            .collect();
        assert_eq!(counts[0], counts[1]);
        let mut st = chart(vec![10.0, 40.0], false, &mut cam);
        assert!(st.set_bar_pictorial("diamond", &records(2, r)));
        let f = fills_of(&mut st, &cam);
        let rect = bar_world(&st, 0);
        let top = bbox(within(&f, [rect[0], rect[1], rect[2], rect[3] + 100.0]).into_iter())[3];
        assert!((top - rect[3]).abs() < 1e-3, "clipped at the value");
    }

    #[test]
    fn rotation_and_offset_move_the_symbol_in_screen_space() {
        let mut cam = camera();
        let px = rec(|r| {
            r[3] = 10.0;
            r[4] = 0.0;
            r[5] = 20.0;
            r[6] = 0.0;
            r[11] = 2.0;
        });
        let mut st = chart(vec![20.0], false, &mut cam);
        let w = wpp(&cam);
        assert!(st.set_bar_pictorial("rect", &records(1, px)));
        let base = bbox(
            fills_of(&mut st, &cam)
                .iter()
                .map(|f| [f.position[0], f.position[1]]),
        );
        assert!(
            ((base[2] - base[0]) - 10.0 * w).abs() < 1e-3
                && ((base[3] - base[1]) - 20.0 * w).abs() < 1e-3,
            "unrotated 10 x 20 px box: {base:?}"
        );

        assert!(st.set_bar_pictorial(
            "rect",
            &records(
                1,
                rec(|r| {
                    *r = px;
                    r[16] = 90.0;
                })
            )
        ));
        let rot = bbox(
            fills_of(&mut st, &cam)
                .iter()
                .map(|f| [f.position[0], f.position[1]]),
        );
        assert!(
            ((rot[2] - rot[0]) - 20.0 * w).abs() < 1e-3
                && ((rot[3] - rot[1]) - 10.0 * w).abs() < 1e-3
        );

        // Offset: 10 px right, 50% of the height (10 px) down
        assert!(st.set_bar_pictorial(
            "rect",
            &records(
                1,
                rec(|r| {
                    *r = px;
                    r[12] = 10.0;
                    r[14] = 50.0;
                    r[15] = 1.0;
                })
            )
        ));
        let off = bbox(
            fills_of(&mut st, &cam)
                .iter()
                .map(|f| [f.position[0], f.position[1]]),
        );
        assert!(
            (off[0] - base[0] - 10.0 * w).abs() < 1e-3
                && (off[1] - base[1] + 10.0 * w).abs() < 1e-3
        );
    }

    #[test]
    fn hover_and_emphasis_tint_the_symbols() {
        let mut cam = camera();
        let st = chart(vec![10.0, 20.0], false, &mut cam);
        let mut st = st;
        assert!(st.set_bar_pictorial("rect", &records(2, BASE)));
        let b = bar(&st);
        let style = ChartHoverStyle::default();
        let mut out = Vec::new();
        build_pictorial(b, &b.segs, wpp(&cam), Some(1), &style, &mut out);
        assert_eq!(out.len(), 12);
        assert!(out[..6].iter().all(|f| f.color == b.color_of(0)));
        assert!(out[6..].iter().all(|f| f.color == b.hover_color(1, &style)));
        let mut b = b.clone();
        b.emphasis = Some(1);
        build_pictorial(&b, &b.segs, wpp(&cam), None, &style, &mut out);
        assert!(
            out.iter()
                .all(|f| (f.color[3] - DIMMED_SERIES_ALPHA).abs() < 1e-6),
            "single series: others dim"
        );
        // Non-finite scale: nothing, no NaN
        build_pictorial(&b, &b.segs, f32::NAN, None, &style, &mut out);
        assert!(out.is_empty());
    }

    #[test]
    fn symbols_grow_on_enter_and_tween_on_update() {
        let mut cam = camera();
        let opts = AnimationOptions::new(100.0, Easing::Linear);
        let mut st = chart(vec![10.0, 20.0], false, &mut cam);
        assert!(st.set_bar_pictorial("rect", &records(2, BASE)));
        st.arm_animation(opts, None);
        st.animation_tick(0.0);
        st.animation_tick(50.0);
        let half = fills_of(&mut st, &cam);
        let full_rects = [bar_world(&st, 0), bar_world(&st, 1)];
        for (g, r) in full_rects.iter().enumerate() {
            let col = [r[0], r[1] - 1.0, r[2], r[3] + 1.0];
            let got = bbox(within(&half, col).into_iter());
            assert!(
                ((got[3] - got[1]) - 0.5 * (r[3] - r[1])).abs() < 1e-3,
                "bar {g} half grown"
            );
            assert!((got[1] - r[1]).abs() < 1e-3, "from the base");
        }
        assert!(half
            .iter()
            .all(|f| f.position.iter().all(|c| c.is_finite())));

        let mut done = st.clone();
        done.finish_animation();
        let _ = fills_of(&mut done, &cam);
        let snap = done.anim_snapshot().expect("snapshot");
        let mut next = chart(vec![20.0, 10.0], false, &mut cam);
        assert!(next.set_bar_pictorial("rect", &records(2, BASE)));
        next.arm_animation(opts, Some(snap));
        next.animation_tick(0.0);
        next.animation_tick(50.0);
        assert!(next.anim_is_update());
        let mid = fills_of(&mut next, &cam);
        let to = [bar_world(&next, 0), bar_world(&next, 1)];
        for g in 0..2 {
            let want = 0.5 * (full_rects[g][3] + to[g][3]);
            let col = [to[g][0], -100.0, to[g][2], 100.0];
            let got = bbox(within(&mid, col).into_iter());
            assert!(
                (got[3] - want).abs() < 1e-3,
                "bar {g}: {} vs {want}",
                got[3]
            );
        }
        // Restarting mid-way starts from the frame on screen
        next.begin_update_animation();
        next.animation_tick(0.0);
        let again = fills_of(&mut next, &cam);
        assert_eq!(again, mid, "no jump back to the old target");
    }

    #[test]
    fn svg_export_writes_the_symbols_as_vector_paths() {
        let mut cam = camera();
        let mut st = chart(vec![10.0, 20.0], false, &mut cam);
        assert!(st.set_bar_pictorial("diamond", &records(2, BASE)));
        let _ = st.prepare_layers(&view(&cam));
        let svg = st.export_svg(&view(&cam), 0, "t");
        assert_eq!(svg.support, SvgSupport::Vector);
        assert!(
            svg.marks >= 4 && svg.markup.contains("<path"),
            "{}",
            svg.marks
        );
    }
}
