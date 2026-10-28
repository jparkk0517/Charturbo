//! Y-up scientific charts. Raw coordinates stay separate from bounded render coordinates.
use super::*;
use std::cell::Cell;

#[derive(Debug, Clone)]
pub struct Scientific3DOptions {
    pub bounds: [(Option<f64>, Option<f64>); 3],
    /// None preserves data units; Some sets relative XYZ box dimensions.
    pub aspect: Option<[f32; 3]>,
    /// Zero hides that axis; otherwise 2..=50 ticks.
    pub ticks: [u32; 3],
}
impl Default for Scientific3DOptions {
    fn default() -> Self { Self { bounds: [(None, None); 3], aspect: Some([1.; 3]), ticks: [5; 3] } }
}
impl Scientific3DOptions {
    pub fn validate(&self) -> Result<(), String> {
        if self.bounds.iter().any(|&(lo, hi)| lo.into_iter().chain(hi).any(|v| !(v as f32).is_finite()) || lo.zip(hi).is_some_and(|(a, b)| a >= b))
            || self.aspect.is_some_and(|a| a.iter().any(|v| !v.is_finite() || *v <= 0.))
            || self.ticks.iter().any(|&n| n != 0 && !(2..=50).contains(&n)) {
            return Err("invalid 3D axes or aspect".into());
        }
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct Scientific3DSeries {
    pub xyz: Vec<[f32; 3]>,
    pub colors: Vec<[f32; 4]>,
    pub color: [f32; 4],
    /// Billboard diameter in CSS pixels.
    pub size: f32,
    /// Row-major height grid; None means independent points.
    pub grid: Option<(usize, usize)>,
    pub wireframe: bool,
    pub lighting: f32,
    /// Height isolines of a grid series; None draws none.
    pub contours: Option<Scientific3DContours>,
}

/// Raw-Y isoline heights traced on the rendered triangles, with a final stroke RGBA.
#[derive(Debug, Clone, PartialEq)]
pub struct Scientific3DContours {
    pub levels: Vec<f32>,
    pub color: [f32; 4],
}

#[derive(Debug, Clone)]
pub(crate) struct Scientific3D {
    pub series: Vec<Scientific3DSeries>,
    pub visible: Vec<bool>,
    pub emphasis: Option<usize>,
    domain: [(f64, f64); 3],
    options: Scientific3DOptions,
    half: Vec3,
    offsets: Vec<usize>,
    // Raw XYZ and grid column/row of the most recent ray hit.
    hit: Cell<Option<[f32; 5]>>,
}

impl Scientific3D {
    fn new(series: Vec<Scientific3DSeries>, options: Scientific3DOptions) -> Result<Self, String> {
        options.validate()?;
        let mut n = 0usize;
        for s in &series {
            if !s.size.is_finite() || s.size < 0.0 || !s.lighting.is_finite() || !(0.0..=1.0).contains(&s.lighting)
                || s.color.iter().any(|v| !v.is_finite()) || (!s.colors.is_empty() && s.colors.len() != s.xyz.len())
                || s.colors.iter().flatten().any(|v| !v.is_finite()) {
                return Err("invalid 3D series style or colors".into());
            }
            if let Some(c) = &s.contours {
                if s.grid.is_none() || c.levels.iter().chain(&c.color).any(|v| !v.is_finite()) { return Err("invalid surface contours".into()); }
            }
            if let Some((cols, rows)) = s.grid {
                if cols < 2 || rows < 2 || cols.checked_mul(rows) != Some(s.xyz.len()) { return Err("invalid surface grid shape".into()); }
            }
            n = n.checked_add(s.xyz.len()).filter(|n| *n <= 4_000_000).ok_or("3D chart exceeds 4000000 samples")?;
        }
        let mut series = series;
        for c in series.iter_mut().filter_map(|s| s.contours.as_mut()) { c.levels.sort_by(f32::total_cmp); c.levels.dedup(); }
        let mut chart = Self { visible: vec![true; series.len()], series, domain: [(0., 1.); 3], options, half: Vec3::splat(60.), offsets: vec![], emphasis: None, hit: Cell::new(None) };
        chart.reindex();
        Ok(chart)
    }

    fn reindex(&mut self) {
        let mut domain = [(f64::INFINITY, f64::NEG_INFINITY); 3];
        self.offsets.clear();
        let mut n = 0;
        for s in &self.series {
            self.offsets.push(n); n += s.xyz.len();
            for p in s.xyz.iter().filter(|p| p.iter().all(|v| v.is_finite())) {
                for a in 0..3 { domain[a].0 = domain[a].0.min(p[a] as f64); domain[a].1 = domain[a].1.max(p[a] as f64); }
            }
        }
        for (a, d) in domain.iter_mut().enumerate() {
            if !d.0.is_finite() { *d = (-1.0, 1.0); }
            if d.0 == d.1 { let pad = d.0.abs().max(1.0) * 0.05; d.0 -= pad; d.1 += pad; }
            let (lo, hi) = self.options.bounds[a];
            d.0 = lo.unwrap_or(d.0); d.1 = hi.unwrap_or(d.1);
            // A one-sided fixed bound can move past every sample while streaming.
            if d.0 >= d.1 {
                if lo.is_some() { d.1 = d.0 + d.0.abs().max(1.) * 0.05; }
                else { d.0 = d.1 - d.1.abs().max(1.) * 0.05; }
            }
        }
        self.domain = domain;
        let spans = self.options.aspect.map(|a| a.map(f64::from)).unwrap_or_else(|| domain.map(|(lo, hi)| hi - lo));
        let max = spans.into_iter().fold(0.0_f64, f64::max);
        self.half = Vec3::from_array(spans.map(|s| (60. * s / max) as f32));
        self.hit.set(None);
    }

    fn world(&self, p: [f32; 3]) -> Vec3 {
        Vec3::from_array(std::array::from_fn(|a| (((p[a] as f64 - self.domain[a].0) / (self.domain[a].1 - self.domain[a].0) * 2.0 - 1.0) * self.half[a] as f64) as f32))
    }

    pub fn frame_camera(&self, camera: &mut OrbitCamera) {
        camera.set_pose(Vec3::new(220., 170., 300.), Vec3::ZERO);
        let corners = (0..8).map(|i| Vec3::from_array(std::array::from_fn(|a| if i & (1 << a) == 0 { -self.half[a] } else { self.half[a] })));
        camera.fit_to_points(Vec3::ZERO, corners, self.half.length(), 0.76);
    }

    pub fn len(&self) -> usize { self.series.iter().map(|s| s.xyz.len()).sum() }

    pub fn sample(&self, id: u32) -> Option<(u32, u32, f32, Vec3)> {
        let s = self.offsets.iter().rposition(|&o| o <= id as usize)?;
        let i = id as usize - self.offsets[s];
        let p = *self.series[s].xyz.get(i)?;
        p.iter().all(|v| v.is_finite()).then(|| (s as u32, i as u32, p[1], self.world(p)))
    }

    fn cells(&self, s: usize, mut f: impl FnMut(usize, [usize; 4])) {
        let series = &self.series[s];
        let Some((cols, rows)) = series.grid else { return; };
        for row in 0..rows - 1 { for col in 0..cols - 1 {
            let i = row * cols + col;
            let ids = [i, i + 1, i + cols, i + cols + 1];
            if ids.iter().all(|&j| series.xyz[j].iter().all(|v| v.is_finite())) { f(i, ids); }
        }}
    }

    pub fn build(&self, fills: &mut Vec<ChartFillRaw>, contours_out: &mut Vec<ChartFillRaw>, lines: &mut Vec<ChartSegmentRaw>, markers: &mut Vec<ChartMarkerRaw>) {
        fills.clear(); contours_out.clear(); lines.clear(); markers.clear();
        for (s, series) in self.series.iter().enumerate().filter(|(s, _)| self.visible[*s]) {
            let color = |i: usize| { let mut c = series.colors.get(i).copied().unwrap_or(series.color); if self.emphasis.is_some_and(|e| e != s) { c[3] *= 0.2; } c };
            if series.grid.is_none() {
                if series.size == 0.0 { continue; }
                for (i, &raw) in series.xyz.iter().enumerate().filter(|(_, p)| p.iter().all(|v| v.is_finite())) {
                    let p = self.world(raw);
                    let c = color(i);
                    if c[3] <= 0.0 { continue; }
                    markers.push(ChartMarkerRaw { center_radius: [p.x, p.y, p.z, series.size * 0.5], fill: c, ring: c, params: [0.; 4] });
                }
            } else {
                self.cells(s, |_, ids| {
                    let p = ids.map(|i| self.world(series.xyz[i]));
                    for tri in [[0, 2, 1], [1, 2, 3]] {
                        if tri.iter().all(|&k| color(ids[k])[3] <= 0.) { continue; }
                        if !series.wireframe {
                            let normal = (p[tri[1]] - p[tri[0]]).cross(p[tri[2]] - p[tri[0]]).normalize_or_zero();
                            let light = 1.0 - series.lighting * (1.0 - (0.3 + 0.7 * normal.dot(Vec3::new(0.4, 0.85, 0.35).normalize()).abs()));
                            for k in tri { let mut c = color(ids[k]); for v in &mut c[..3] { *v *= light; } fills.push(ChartFillRaw { position: p[k].extend(0.).to_array(), color: c }); }
                        }
                    }
                    if series.wireframe {
                        for [a, b] in [[0, 1], [1, 3], [3, 2], [2, 0]] {
                            if color(ids[a])[3] <= 0. { continue; }
                            lines.push(ChartSegmentRaw { p0_width: p[a].extend(1.).to_array(), p1_pad: p[b].extend(0.).to_array(), color: color(ids[a]) });
                        }
                    }
                    if let Some(contours) = &series.contours {
                        let mut stroke = contours.color;
                        if self.emphasis.is_some_and(|e| e != s) { stroke[3] *= 0.2; }
                        for tri in [[0, 2, 1], [1, 2, 3]] {
                            let raw = tri.map(|k| series.xyz[ids[k]]);
                            // Hairlines lie exactly in the triangle plane; extruded strokes would
                            // keep one depth across the line and sink into sloped surfaces.
                            for (a, b) in isolines(raw, &contours.levels) {
                                for p in [a, b] { contours_out.push(ChartFillRaw { position: self.world(p).extend(0.).to_array(), color: stroke }); }
                            }
                        }
                    }
                });
            }
        }
    }

    pub fn grid(&self, style: &ChartFrameStyle, out: &mut Vec<ChartSegmentRaw>) {
        out.clear();
        if !style.show_grid { return; }
        let mut segment = |a: Vec3, b: Vec3| out.push(ChartSegmentRaw { p0_width: a.extend(style.stroke_px).to_array(), p1_pad: b.extend(0.).to_array(), color: style.grid_color });
        for axis in 0..3 { for i in 0..self.options.ticks[axis] {
            let mut a = -self.half; a[axis] += i as f32 / (self.options.ticks[axis] - 1) as f32 * self.half[axis] * 2.;
            for cross in 0..3 { if cross != axis { let mut b = a; b[cross] = self.half[cross]; segment(a, b); } }
        }}
    }

    pub fn axes(&self, view: &ChartView, out: &mut AxisLayout) {
        out.ticks.clear(); out.plot_css = [0., 0., view.viewport_px.0 as f32 / view.pixel_ratio, view.viewport_px.1 as f32 / view.pixel_ratio];
        let eye = view.camera.eye_position();
        let front_x = if eye.x >= 0. { self.half.x } else { -self.half.x };
        let front_z = if eye.z >= 0. { self.half.z } else { -self.half.z };
        for a in 0..3 { for i in 0..self.options.ticks[a] {
            let t = i as f64 / (self.options.ticks[a] - 1) as f64;
            let mut p = match a {
                0 => Vec3::new(0., -self.half.y, front_z),
                1 => Vec3::new(-front_x, 0., front_z),
                _ => Vec3::new(front_x, -self.half.y, 0.),
            };
            p[a] = (t as f32 * 2. - 1.) * self.half[a];
            let span = self.domain[a].1 - self.domain[a].0;
            let value = self.domain[a].0 + t * span;
            // Snap only interior cancellation noise; preserve even tiny fixed endpoints.
            let value = if i > 0 && i + 1 < self.options.ticks[a] && value.abs() < span * 1e-14 { 0. } else { value };
            if let Some((x, y)) = view.project_css(p) { out.ticks.push(AxisTick { axis: if a == 2 { 3 } else { a as u8 }, value, x_css: x, y_css: y, granularity: 0 }); }
        }}
    }

    pub fn hover(&self, view: &ChartView, ndc: (f32, f32), style: &ChartHoverStyle) -> Option<HoverResult> {
        self.hit.set(None);
        let ray = view.camera.screen_to_ray(ndc.0, ndc.1);
        let cursor = view.ndc_to_px(ndc.0, ndc.1);
        let mut best = f32::INFINITY;
        let mut item = None;
        for (s, series) in self.series.iter().enumerate().filter(|(s, _)| self.visible[*s]) {
            let mut record = |i: usize, distance: f32, p: Vec3, col: f32, row: f32| {
                if distance < best { best = distance; self.hit.set(Some([p.x, p.y, p.z, col, row])); item = Some(HoverItem { series: s as u32, index: i as u32, value: p.y, global_id: (self.offsets[s] + i) as u32 }); }
            };
            if let Some((cols, _)) = series.grid {
                self.cells(s, |i, ids| {
                    for tri in [[ids[0], ids[2], ids[1]], [ids[1], ids[2], ids[3]]] {
                        let p = tri.map(|j| self.world(series.xyz[j]));
                        if let Some((t, u, v)) = intersect(&ray, p) {
                            let alpha = tri.map(|j| series.colors.get(j).unwrap_or(&series.color)[3]);
                            if alpha[0] * (1. - u - v) + alpha[1] * u + alpha[2] * v <= 0. { continue; }
                            let raw = tri.map(|j| Vec3::from_array(series.xyz[j]));
                            record(i, t, raw[0] * (1. - u - v) + raw[1] * u + raw[2] * v, (i % cols) as f32, (i / cols) as f32);
                        }
                    }
                });
            } else if series.size > 0.0 {
                for (i, &p) in series.xyz.iter().enumerate().filter(|(_, p)| p.iter().all(|v| v.is_finite())) {
                    if series.colors.get(i).unwrap_or(&series.color)[3] <= 0.0 { continue; }
                    let world = self.world(p);
                    let clip = view.camera.view_proj_matrix() * world.extend(1.);
                    if clip.w <= 0. || clip.z < 0. || clip.z > clip.w { continue; }
                    if let Some(q) = view.project_px(world) {
                        let d = ((q.0 - cursor.0).powi(2) + (q.1 - cursor.1).powi(2)).sqrt();
                        if d <= (series.size * 0.5 + style.hit_radius_px) * view.pixel_ratio { record(i, (world - ray.origin).length(), Vec3::from_array(p), -1., -1.); }
                    }
                }
            }
        }
        item.map(|i| HoverResult { is_bar: false, primary: 0, items: vec![i] })
    }
}

/// Marching triangles: each level crossing a planar triangle yields one raw-space segment.
/// Vertices at or above a level count as inside, matching marching-squares conventions.
fn isolines(p: [[f32; 3]; 3], levels: &[f32]) -> impl Iterator<Item = ([f32; 3], [f32; 3])> + '_ {
    let (lo, hi) = (p[0][1].min(p[1][1]).min(p[2][1]), p[0][1].max(p[1][1]).max(p[2][1]));
    let first = levels.partition_point(|&l| l <= lo);
    let last = levels.partition_point(|&l| l <= hi);
    levels[first..last].iter().filter_map(move |&level| {
        let mut ends = [[0.; 3]; 2];
        let mut n = 0;
        for (a, b) in [(0, 1), (1, 2), (2, 0)] {
            let (ya, yb) = (p[a][1], p[b][1]);
            if (ya >= level) == (yb >= level) { continue; }
            let t = (level - ya) / (yb - ya);
            ends[n] = std::array::from_fn(|k| if k == 1 { level } else { p[a][k] + t * (p[b][k] - p[a][k]) });
            n += 1;
        }
        (n == 2).then_some((ends[0], ends[1]))
    })
}

fn intersect(ray: &Ray, p: [Vec3; 3]) -> Option<(f32, f32, f32)> {
    let (e1, e2) = (p[1] - p[0], p[2] - p[0]);
    let h = ray.direction.cross(e2);
    let det = e1.dot(h);
    if det.abs() < 1e-7 { return None; }
    let s = ray.origin - p[0];
    let u = s.dot(h) / det;
    let q = s.cross(e1);
    let v = ray.direction.dot(q) / det;
    let t = e2.dot(q) / det;
    (u >= 0. && v >= 0. && u + v <= 1. && t >= 0.).then_some((t, u, v))
}

impl ChartState {
    pub fn is_scientific3d(&self) -> bool { matches!(self.kind, ChartKind::Scientific3D(_)) }
    pub fn new_scientific3d(series: Vec<Scientific3DSeries>) -> Result<Self, String> { Self::new_scientific3d_with_options(series, Scientific3DOptions::default()) }
    pub fn new_scientific3d_with_options(series: Vec<Scientific3DSeries>, options: Scientific3DOptions) -> Result<Self, String> { Ok(Self::with_kind(ChartKind::Scientific3D(Scientific3D::new(series, options)?))) }
    pub fn scientific_hit(&self) -> Option<[f32; 5]> { if let ChartKind::Scientific3D(c) = &self.kind { c.hit.get() } else { None } }

    /// Atomically replaces one series' samples, preserving style, visibility and chart state.
    /// Domain/ids are recomputed globally; the next frame rebuilds staged geometry.
    /// `contours` replaces the series' isolines (None removes them).
    pub fn update_scientific3d_series(&mut self, series: usize, xyz: Vec<[f32; 3]>, colors: Vec<[f32; 4]>, grid: Option<(usize, usize)>, contours: Option<Scientific3DContours>) -> Result<usize, String> {
        let ChartKind::Scientific3D(c) = &mut self.kind else { return Err("no scientific 3D chart".into()); };
        let old = c.series.get(series).ok_or("3D series index out of range")?;
        if old.grid.is_some() != grid.is_some() { return Err("cannot change 3D series kind during update".into()); }
        let n = xyz.len();
        if (c.len() - old.xyz.len()).checked_add(n).is_none_or(|n| n > 4_000_000) { return Err("3D chart exceeds 4000000 samples".into()); }
        let next = Scientific3DSeries { xyz, colors, grid, color: old.color, size: old.size, wireframe: old.wireframe, lighting: old.lighting, contours };
        // Validate off to the side before mutating any live data or hover state.
        let mut checked = Scientific3D::new(vec![next], Scientific3DOptions::default())?;
        c.series[series] = checked.series.pop().unwrap();
        c.reindex();
        self.hover = None;
        self.dirty = Dirty::all();
        self.axes_key = None;
        Ok(n)
    }
}
