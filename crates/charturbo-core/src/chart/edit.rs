//! Point editing support (SDK point drag / click to add): maps a pointer in NDC to data units on
//! the active 2D chart, with the visible data range for clamping. Scatter point moves / appends
//! live in scatter/edit.rs; line edits go through `set_series_data`.

use super::*;

impl ChartState {
    /// Data under NDC `p` with y on axis `axis` (1 = right axis of a dual-axis line chart):
    /// `[x, y, x_lo, x_hi, y_lo, y_hi]` where the last four are the visible data range (ordered).
    /// `None` outside 2D views or when the pointer misses the plot plane. Not clamped.
    pub fn ndc_to_data(&self, view: &ChartView, p: (f32, f32), axis: u8) -> Option<[f64; 6]> {
        if !(p.0.is_finite() && p.1.is_finite()) {
            return None;
        }
        let f = self.annotation_frame()?;
        let y = if axis == 1 { f.y2 } else { f.y };
        let w = ray_hit_z_plane(&view.camera.screen_to_ray(p.0, p.1), f.z)?;
        let [bx0, bx1, by0, by1] = f.bounds;
        let order = |a: f64, b: f64| if a <= b { (a, b) } else { (b, a) };
        let (x_lo, x_hi) = order(f.x.unmap(bx0), f.x.unmap(bx1));
        let (y_lo, y_hi) = order(y.unmap(by0), y.unmap(by1));
        Some([f.x.unmap(w.x), y.unmap(w.y), x_lo, x_hi, y_lo, y_hi])
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

    fn framed(chart: &ChartState) -> OrbitCamera {
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        cam
    }

    fn ndc_of(chart: &ChartState, cam: &OrbitCamera, id: u32) -> (f32, f32) {
        let n = cam.project_to_ndc(chart.sample(id).unwrap().3).unwrap();
        (n.x, n.y)
    }

    #[test]
    fn ndc_maps_back_to_the_data_of_a_line_point_with_the_visible_range() {
        let chart = ChartState::new_line(
            vec![LineSeries {
                values: vec![2.0, 8.0, 5.0],
                x: None,
                color: [1.0; 4],
                width_px: 2.0,
            }],
            LineLayout {
                width: 160.0,
                height: 80.0,
                view: ChartViewMode::Flat,
                x_kind: LineXKind::Numeric,
            },
        );
        let cam = framed(&chart);
        let d = chart
            .ndc_to_data(&view(&cam), ndc_of(&chart, &cam, 1), 0)
            .unwrap();
        assert!((d[0] - 1.0).abs() < 1e-3, "x = sample index, got {}", d[0]);
        assert!((d[1] - 8.0).abs() < 1e-3, "y, got {}", d[1]);
        assert!(
            (d[2] - 0.0).abs() < 1e-3 && (d[3] - 2.0).abs() < 1e-3,
            "x range {d:?}"
        );
        assert!(
            d[4] <= 2.0 && d[5] >= 8.0 && d[4] < d[5],
            "y range covers the data {d:?}"
        );
        assert!(chart.ndc_to_data(&view(&cam), (f32::NAN, 0.0), 0).is_none());
    }

    #[test]
    fn ndc_maps_back_to_scatter_data() {
        let chart = ChartState::new_scatter(
            ScatterPoints {
                xs: vec![1.0, 4.0, 9.0],
                ys: vec![10.0, 30.0, 20.0],
                ..Default::default()
            },
            ScatterLayout::default(),
        );
        let cam = framed(&chart);
        let d = chart
            .ndc_to_data(&view(&cam), ndc_of(&chart, &cam, 2), 0)
            .unwrap();
        assert!(
            (d[0] - 9.0).abs() < 1e-3 && (d[1] - 20.0).abs() < 1e-3,
            "{d:?}"
        );
        assert!(
            d[2] <= 1.0 && d[3] >= 9.0 && d[4] <= 10.0 && d[5] >= 30.0,
            "{d:?}"
        );
    }
}
