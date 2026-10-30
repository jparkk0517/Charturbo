//! In-place scatter point edits (SDK point drag / click to add): a point moves or a new one is
//! appended without re-laying out the chart, so the nice domains, the zoom window, legend
//! visibility and emphasis stay. Points outside the domain are still drawn (clipped by the plot).

use super::*;

impl ScatterChart {
    /// Normalized position of point `i` in the current domains (NaN when not drawable).
    fn norm_of(&self, i: usize) -> [f32; 2] {
        let (sx, sy) = (self.x_scale, self.y_scale);
        let mut p = (sx.fwd(self.xs[i] as f64), sy.fwd(self.ys[i] as f64));
        let ([jx, jy], seed) = (self.jitter, self.jitter_seed);
        if jx > 0.0 {
            p.0 += jx * jitter_unit(i, 0, seed);
        }
        if jy > 0.0 {
            p.1 += jy * jitter_unit(i, 1, seed);
        }
        if !(p.0.is_finite() && p.1.is_finite()) {
            return [f32::NAN; 2];
        }
        let (dx, dy) = (self.x_domain, self.y_domain);
        [
            ((p.0 - dx.0) / (dx.1 - dx.0)) as f32,
            ((p.1 - dy.0) / (dy.1 - dy.0)) as f32,
        ]
    }

    /// Re-fits every trendline to the current values and rebuilds the hover grid.
    fn refresh_after_edit(&mut self) {
        let lines: Vec<ScatterTrendline> = self.trendlines.iter().map(|(l, _)| *l).collect();
        self.trendlines.clear();
        self.set_trendlines(&lines);
        self.grid = PointGrid::build(&self.t);
    }

    /// Moves point `i` to `(x, y)`. False when `i` is out of range or a value is not finite.
    pub(crate) fn move_point(&mut self, i: usize, x: f32, y: f32) -> bool {
        if i >= self.len() || !(x.is_finite() && y.is_finite()) {
            return false;
        }
        self.xs[i] = x;
        self.ys[i] = y;
        self.t[i] = self.norm_of(i);
        self.refresh_after_edit();
        true
    }

    /// Appends a point of series `series` (an existing series id, or 0 on an empty chart) in the
    /// color of that series' first point. Returns its index.
    pub(crate) fn append_point(&mut self, x: f32, y: f32, series: u16) -> Option<usize> {
        let s = series as usize;
        if !(x.is_finite() && y.is_finite())
            || (s >= self.visible.len() && !(self.visible.is_empty() && s == 0))
        {
            return None;
        }
        let n = self.len();
        let color = (0..n)
            .find(|&i| self.series_of(i) == s)
            .map(|i| self.colors[i])
            .or_else(|| self.colors.first().copied())
            .unwrap_or(to_rgba8(DEFAULT_POINT_COLOR));
        if s != 0 && self.series.is_empty() {
            self.series = vec![0; n];
        }
        if !self.series.is_empty() {
            self.series.push(series);
        }
        if !self.sizes.is_empty() {
            self.sizes.push(self.layout.radius_px);
        }
        if self.visible.is_empty() {
            self.visible.push(true);
        }
        self.colors.push(color);
        self.xs.push(x);
        self.ys.push(y);
        self.t.push([f32::NAN; 2]);
        self.t[n] = self.norm_of(n);
        self.refresh_after_edit();
        Some(n)
    }
}

impl ChartState {
    fn after_scatter_edit(&mut self) {
        self.hover = None;
        self.dirty = Dirty::all();
    }

    /// Moves scatter point `index` to `(x, y)` keeping the domains and zoom window. False for
    /// other charts, an unknown index or non-finite values.
    pub fn set_scatter_point(&mut self, index: usize, x: f32, y: f32) -> bool {
        let ChartKind::Scatter(s) = &mut self.kind else {
            return false;
        };
        let moved = s.move_point(index, x, y);
        if moved {
            self.after_scatter_edit();
        }
        moved
    }

    /// Appends a scatter point to series `series` keeping the domains and zoom window; returns
    /// its index (`None` for other charts, an unknown series or non-finite values).
    pub fn append_scatter_point(&mut self, x: f32, y: f32, series: u16) -> Option<usize> {
        let ChartKind::Scatter(s) = &mut self.kind else {
            return None;
        };
        let index = s.append_point(x, y, series)?;
        self.after_scatter_edit();
        Some(index)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn view(cam: &OrbitCamera) -> ChartView<'_> {
        ChartView {
            camera: cam,
            viewport_px: (1600, 900),
            pixel_ratio: 1.0,
        }
    }

    fn scatter() -> ChartState {
        ChartState::new_scatter(
            ScatterPoints {
                xs: vec![0.0, 5.0, 10.0],
                ys: vec![0.0, 50.0, 100.0],
                series: vec![0, 1, 1],
                series_colors: vec![[1.0, 0.0, 0.0, 1.0], [0.0, 0.0, 1.0, 1.0]],
                ..Default::default()
            },
            ScatterLayout::default(),
        )
    }

    fn inner(chart: &ChartState) -> &ScatterChart {
        match &chart.kind {
            ChartKind::Scatter(s) => s,
            _ => unreachable!(),
        }
    }

    fn framed(chart: &ChartState) -> OrbitCamera {
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        cam
    }

    #[test]
    fn moving_a_point_keeps_the_domain_window_and_visibility_and_moves_the_hover_target() {
        let mut chart = scatter();
        let mut scene = crate::scene::SceneWorld::default();
        let cam = framed(&chart);
        chart.zoom_xy(&view(&cam), 0.5, (0.1, 0.1));
        chart.set_series_visible(0, false, &mut scene);
        let (dx, dy, wx) = {
            let s = inner(&chart);
            (s.x_domain, s.y_domain, s.window_x)
        };
        assert!(chart.set_scatter_point(1, 7.0, 60.0));
        let s = inner(&chart);
        assert_eq!(
            (s.x_domain, s.y_domain, s.window_x),
            (dx, dy, wx),
            "no re-layout"
        );
        assert!(!s.visible[0], "legend state kept");
        assert_eq!((s.xs[1], s.ys[1]), (7.0, 60.0));
        let p = chart.sample(1).unwrap().3;
        let world = chart.data_to_world(7.0, 60.0).unwrap();
        assert!((p - world).length() < 1e-3, "point drawn at its new value");
        // The hover grid follows the move
        let n = cam.project_to_ndc(world).unwrap();
        let hit = chart.ndc_to_data(&view(&cam), (n.x, n.y), 0).unwrap();
        assert!((hit[0] - 7.0).abs() < 1e-3);
        assert!(!chart.set_scatter_point(9, 1.0, 1.0), "unknown index");
        assert!(!chart.set_scatter_point(0, f32::NAN, 1.0), "non-finite");
    }

    #[test]
    fn appending_a_point_uses_the_series_color_and_keeps_the_domain() {
        let mut chart = scatter();
        let dx = inner(&chart).x_domain;
        assert_eq!(chart.append_scatter_point(2.0, 20.0, 1), Some(3));
        let s = inner(&chart);
        assert_eq!(s.x_domain, dx);
        assert_eq!((s.len(), s.series_of(3), s.colors[3]), (4, 1, s.colors[1]));
        assert!(s.t[3][0].is_finite());
        assert_eq!(
            chart.append_scatter_point(2.0, 20.0, 7),
            None,
            "unknown series"
        );
        assert_eq!(chart.append_scatter_point(f32::INFINITY, 20.0, 0), None);
        // A chart without series ids gains them when a later series is targeted
        let mut plain = ChartState::new_scatter(
            ScatterPoints {
                xs: vec![1.0, 2.0],
                ys: vec![1.0, 2.0],
                ..Default::default()
            },
            ScatterLayout::default(),
        );
        assert_eq!(plain.append_scatter_point(1.5, 1.5, 0), Some(2));
        assert_eq!(inner(&plain).len(), 3);
    }
}
