use super::*;

fn points(xyz: Vec<[f32; 3]>) -> Scientific3DSeries {
    Scientific3DSeries { xyz, colors: vec![], color: [0.2, 0.6, 1.0, 1.0], size: 6.0, grid: None, wireframe: false, lighting: 0.0 }
}

#[test]
fn point_cloud_preserves_ids_gaps_z_and_pixel_diameter() {
    let mut c = ChartState::new_scientific3d(vec![points(vec![[0., 0., -1.], [f32::NAN, 1., 0.], [0., 0., 1.]])]).unwrap();
    assert_eq!(c.point_count(), 3);
    assert!(c.sample(1).is_none());
    assert!(c.sample(0).unwrap().3.z < c.sample(2).unwrap().3.z);
    let mut camera = OrbitCamera::new(300., 1.);
    c.frame_camera(&mut camera, (600., 600.));
    let view = ChartView { camera: &camera, viewport_px: (600, 600), pixel_ratio: 2. };
    let layers = c.prepare_layers(&view);
    assert!(layers.depth_3d);
    let marks = layers.series_style.unwrap().markers;
    assert_eq!(marks.len(), 2);
    assert_eq!(marks[0].center_radius[3], 3.);
    assert_eq!(c.export_svg(&view, 100, "test").support, SvgSupport::Raster);
}

#[test]
fn surface_grid_is_y_up_and_holes_never_bridge() {
    let mut s = points(vec![[0., 0., 0.], [1., 1., 0.], [0., 2., 1.], [1., 3., 1.]]);
    s.grid = Some((2, 2));
    let mut c = ChartState::new_scientific3d(vec![s.clone()]).unwrap();
    assert!(c.sample(2).unwrap().3.y > c.sample(1).unwrap().3.y);
    let mut cam = OrbitCamera::new(300., 1.);
    c.frame_camera(&mut cam, (600., 600.));
    let v = ChartView { camera: &cam, viewport_px: (600, 600), pixel_ratio: 1. };
    assert_eq!(c.prepare_layers(&v).fills.unwrap().len(), 6);
    s.xyz[0][1] = f32::NAN;
    let mut hole = ChartState::new_scientific3d(vec![s]).unwrap();
    assert!(hole.prepare_layers(&v).fills.unwrap().is_empty());
}

#[test]
fn point_pick_prefers_frontmost_and_hidden_series_do_not_pick() {
    let mut c = ChartState::new_scientific3d(vec![points(vec![[0., 0., -1.]]), points(vec![[0., 0., 1.]])]).unwrap();
    let mut cam = OrbitCamera::new(300., 1.);
    cam.set_pose(Vec3::new(0., 0., 300.), Vec3::ZERO);
    let v = ChartView { camera: &cam, viewport_px: (600, 600), pixel_ratio: 1. };
    let mut scene = SceneWorld::new();
    assert_eq!(c.hover_at(&v, &mut scene, (0., 0.)).unwrap().items[0].global_id, 1);
    c.set_series_visible(1, false, &mut scene);
    assert_eq!(c.hover_at(&v, &mut scene, (0., 0.)).unwrap().items[0].global_id, 0);
}

#[test]
fn surface_pick_intersects_triangles_and_rejects_bad_shapes() {
    let mut s = points(vec![[-1., 0., -1.], [1., 0., -1.], [-1., 0., 1.], [1., 0., 1.]]);
    s.grid = Some((2, 2));
    let mut c = ChartState::new_scientific3d(vec![s.clone()]).unwrap();
    let mut cam = OrbitCamera::new(300., 1.);
    cam.set_pose(Vec3::new(0., 250., 150.), Vec3::ZERO);
    let v = ChartView { camera: &cam, viewport_px: (600, 600), pixel_ratio: 1. };
    let hit = c.hover_at(&v, &mut SceneWorld::new(), (0., 0.)).unwrap();
    assert_eq!(hit.items[0].value, 0.);
    let p = c.scientific_hit().unwrap();
    assert!(p[0].abs() < 1e-3 && p[1].abs() < 1e-3 && p[2].abs() < 1e-3);
    s.grid = Some((3, 2));
    assert!(ChartState::new_scientific3d(vec![s]).is_err());
}

#[test]
fn transparent_surface_neither_draws_nor_picks() {
    let mut s = points(vec![[-1., 0., -1.], [1., 0., -1.], [-1., 0., 1.], [1., 0., 1.]]);
    s.grid = Some((2, 2));
    s.color[3] = 0.;
    let mut c = ChartState::new_scientific3d(vec![s]).unwrap();
    let mut cam = OrbitCamera::new(300., 1.);
    cam.set_pose(Vec3::new(0., 250., 150.), Vec3::ZERO);
    let v = ChartView { camera: &cam, viewport_px: (600, 600), pixel_ratio: 1. };
    assert!(c.hover_at(&v, &mut SceneWorld::new(), (0., 0.)).is_none());
    assert!(c.prepare_layers(&v).fills.unwrap().is_empty());
}

#[test]
fn axes_follow_the_front_floor_edges_instead_of_crossing_the_surface() {
    let mut c = ChartState::new_scientific3d(vec![points(vec![[-1.; 3], [1.; 3]])]).unwrap();
    let mut cam = OrbitCamera::new(300., 1.);
    cam.set_pose(Vec3::new(220., 170., 300.), Vec3::ZERO);
    let v = ChartView { camera: &cam, viewport_px: (600, 600), pixel_ratio: 1. };
    c.prepare_layers(&v);
    let axes = c.axes();
    let x = axes.ticks.iter().find(|t| t.axis == 0).unwrap();
    let expected = v.project_css(Vec3::new(-60., -60., 60.)).unwrap();
    assert!((x.x_css - expected.0).abs() < 1e-3 && (x.y_css - expected.1).abs() < 1e-3);
    assert_eq!(axes.ticks.iter().filter(|t| t.axis == 3).count(), 5);
}
