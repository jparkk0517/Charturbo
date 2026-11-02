//! Exact look-at mode (`OrbitCamera::set_view`): unclamped distance / pitch, up + roll, the
//! fixed exact near plane and the conversion back to orbit.

use super::*;

fn mat_close(a: Mat4, b: Mat4, eps: f32) -> bool {
    a.to_cols_array().iter().zip(b.to_cols_array()).all(|(x, y)| (x - y).abs() <= eps)
}

fn vec_close(a: Vec3, b: Vec3, eps: f32) -> bool {
    (a - b).length() <= eps
}

/// Target projects to the screen center, in front of the near plane, and the center ray points
/// from the eye at the target.
fn assert_centered(cam: &OrbitCamera, eye: Vec3, target: Vec3) {
    let ndc = cam.project_to_ndc(target).expect("target clipped");
    assert!(ndc.x.abs() < 1e-4 && ndc.y.abs() < 1e-4, "{ndc:?}");
    assert!(ndc.z > 0.0 && ndc.z < 1.0, "{ndc:?}");
    let ray = cam.screen_to_ray(0.0, 0.0);
    assert!(vec_close(ray.origin, eye, 1e-4), "{:?}", ray.origin);
    assert!(vec_close(ray.direction, (target - eye).normalize(), 1e-4), "{:?}", ray.direction);
    let fwd = (target - eye).normalize();
    let (right, up) = cam.billboard_axes();
    assert!(right.dot(fwd).abs() < 1e-5 && up.dot(fwd).abs() < 1e-5 && right.dot(up).abs() < 1e-5);
    assert!((right.length() - 1.0).abs() < 1e-5 && (up.length() - 1.0).abs() < 1e-5);
}

#[test]
fn close_up_0_2_units_is_exact_and_not_clipped() {
    let mut cam = OrbitCamera::new(100.0, 16.0 / 9.0);
    let target = Vec3::new(1.0, 1.5, -2.0);
    let eye = target + Vec3::new(0.0, 0.0, 0.2);
    assert!(cam.set_view(eye, target, None, 0.0));
    assert!(cam.is_exact_view());
    assert_eq!(cam.eye_position(), eye);
    assert_eq!(cam.target(), target);
    assert!((cam.distance() - 0.2).abs() < 1e-6);
    assert!(mat_close(cam.view_matrix(), Mat4::look_at_rh(eye, target, Vec3::Y), 1e-6));
    // Fixed exact near plane (EXACT_NEAR)
    let expected_proj = Mat4::perspective_rh(cam.fov_y(), cam.aspect(), 2000.0, 0.01);
    assert!(mat_close(cam.projection_matrix(), expected_proj, 1e-5));
    assert_centered(&cam, eye, target);
    // Geometry between the eye and the target (0.05 from the eye) is still drawn
    assert!(cam.project_to_ndc(eye + (target - eye).normalize() * 0.05).is_some());
    // The orbit pose of the same request is pushed back to 5 units
    let mut orbit = OrbitCamera::new(100.0, 16.0 / 9.0);
    orbit.set_pose(eye, target);
    assert!((orbit.distance() - 5.0).abs() < 1e-6);
}

#[test]
fn straight_down_uses_minus_z_up_and_straight_up_plus_z() {
    let mut cam = OrbitCamera::new(100.0, 1.0);
    let (eye, target) = (Vec3::new(3.0, 40.0, -1.0), Vec3::new(3.0, 0.0, -1.0));
    assert!(cam.set_view(eye, target, None, 0.0));
    assert!(mat_close(cam.view_matrix(), Mat4::look_at_rh(eye, target, Vec3::NEG_Z), 1e-6));
    assert!((cam.pitch() - std::f32::consts::FRAC_PI_2).abs() < 1e-5);
    assert_centered(&cam, eye, target);
    // -Z is screen-up, +X screen-right (an orbit camera at yaw 0 tilted to 90 deg)
    let north = cam.project_to_ndc(target + Vec3::NEG_Z).unwrap();
    assert!(north.y > 0.01 && north.x.abs() < 1e-5, "{north:?}");
    let east = cam.project_to_ndc(target + Vec3::X).unwrap();
    assert!(east.x > 0.01 && east.y.abs() < 1e-5, "{east:?}");
    assert!((cam.yaw() - 0.0).abs() < 1e-5);

    let (eye, target) = (Vec3::new(0.0, -10.0, 0.0), Vec3::ZERO);
    assert!(cam.set_view(eye, target, Some(Vec3::Y), 0.0));
    assert!(mat_close(cam.view_matrix(), Mat4::look_at_rh(eye, target, Vec3::Z), 1e-6));
    assert!((cam.pitch() + std::f32::consts::FRAC_PI_2).abs() < 1e-5);
    assert_centered(&cam, eye, target);

    // A custom up parallel to a horizontal view direction falls back to +Y
    assert!(cam.set_view(Vec3::new(0.0, 0.0, 10.0), Vec3::ZERO, Some(Vec3::Z), 0.0));
    assert!(mat_close(cam.view_matrix(), Mat4::look_at_rh(Vec3::new(0.0, 0.0, 10.0), Vec3::ZERO, Vec3::Y), 1e-6));
}

#[test]
fn roll_30_deg_rotates_the_right_vector_by_30_deg() {
    let mut cam = OrbitCamera::new(100.0, 1.0);
    let (eye, target) = (Vec3::new(0.0, 0.0, 10.0), Vec3::ZERO);
    let roll = 30f32.to_radians();
    assert!(cam.set_view(eye, target, None, roll));
    let (s, c) = roll.sin_cos();
    let (right, up) = cam.billboard_axes();
    // Unrolled right is +X; rolled right turns 30 deg about the view axis
    assert!(vec_close(right, Vec3::new(c, -s, 0.0), 1e-6), "{right:?}");
    assert!(vec_close(up, Vec3::new(s, c, 0.0), 1e-6), "{up:?}");
    assert!((right.dot(Vec3::X) - c).abs() < 1e-6);
    assert!(mat_close(cam.view_matrix(), Mat4::look_at_rh(eye, target, Vec3::new(s, c, 0.0)), 1e-6));
    // World +X shows 30 deg counterclockwise from screen right
    let p = cam.project_to_ndc(Vec3::X).unwrap();
    assert!((p.y.atan2(p.x) - roll).abs() < 1e-4, "{p:?}");
    assert_centered(&cam, eye, target);
    // Roll applies on top of the straight-down fallback too
    assert!(cam.set_view(Vec3::new(0.0, 10.0, 0.0), Vec3::ZERO, None, roll));
    assert_centered(&cam, Vec3::new(0.0, 10.0, 0.0), Vec3::ZERO);
}

#[test]
fn exact_view_of_an_orbit_pose_matches_the_orbit_camera() {
    let orbit = OrbitCamera::new(150.0, 1.6);
    let mut cam = orbit.clone();
    assert!(cam.set_view(orbit.eye_position(), orbit.target(), None, 0.0));
    // Same view; only the near plane differs (fixed exact near)
    assert!(mat_close(cam.view_matrix(), orbit.view_matrix(), 1e-5));
    assert!((cam.yaw() - orbit.yaw()).abs() < 1e-5 && (cam.pitch() - orbit.pitch()).abs() < 1e-5);
    assert!((cam.distance() - orbit.distance()).abs() < 1e-3);
    // Orbit projection is untouched (near 0.5, far 2000)
    let expected = Mat4::perspective_rh(orbit.fov_y(), orbit.aspect(), 2000.0, 0.5);
    assert!(mat_close(orbit.projection_matrix(), expected, 1e-6));
}

#[test]
fn rejects_eye_equal_target_and_non_finite_input() {
    let mut cam = OrbitCamera::new(100.0, 1.0);
    let before = cam.view_proj_matrix();
    assert!(!cam.set_view(Vec3::ONE, Vec3::ONE, None, 0.0));
    assert!(!cam.set_view(Vec3::new(f32::NAN, 0.0, 0.0), Vec3::ZERO, None, 0.0));
    assert!(!cam.set_view(Vec3::Z, Vec3::ZERO, None, f32::INFINITY));
    assert!(!cam.is_exact_view());
    assert_eq!(cam.view_proj_matrix(), before);
    // A zero / non-finite up means +Y
    assert!(cam.set_view(Vec3::Z * 10.0, Vec3::ZERO, Some(Vec3::ZERO), 0.0));
    assert!(mat_close(cam.view_matrix(), Mat4::look_at_rh(Vec3::Z * 10.0, Vec3::ZERO, Vec3::Y), 1e-6));
}

#[test]
fn orbit_after_set_view_jumps_no_more_than_the_clamp() {
    // Close-up: rotating by zero clamps the distance to 5 along the same direction
    let mut cam = OrbitCamera::new(100.0, 1.0);
    let target = Vec3::new(2.0, 1.0, 0.0);
    let eye = target + Vec3::new(0.1, 0.05, 0.15);
    cam.set_view(eye, target, None, 0.0);
    cam.rotate(0.0, 0.0);
    assert!(!cam.is_exact_view());
    assert_eq!(cam.target(), target);
    assert!((cam.distance() - 5.0).abs() < 1e-5);
    let dir_before = (eye - target).normalize();
    assert!((cam.eye_position() - target).normalize().dot(dir_before) > 0.99999);
    assert!((cam.eye_position() - eye).length() <= 5.0 - (eye - target).length() + 1e-4);

    // Straight down: pitch clamps to the orbit limit, the screen orientation is kept
    let mut cam = OrbitCamera::new(100.0, 1.0);
    let roll = 0.7;
    cam.set_view(Vec3::new(0.0, 50.0, 0.0), Vec3::ZERO, None, roll);
    let (_, up_before) = cam.billboard_axes();
    cam.rotate(0.0, 0.0);
    assert!((cam.pitch() - PITCH_LIMIT).abs() < 1e-6);
    assert!((cam.distance() - 50.0).abs() < 1e-4);
    // Eye moves along the pitch clamp arc only: chord = 2 d sin(0.05 / 2)
    let chord = 2.0 * 50.0 * (0.05f32 / 2.0).sin();
    assert!((cam.eye_position() - Vec3::new(0.0, 50.0, 0.0)).length() <= chord + 1e-3);
    let (_, up_after) = cam.billboard_axes();
    assert!(up_after.dot(up_before) > 0.99, "{up_before:?} {up_after:?}");

    // Inside the orbit ranges: no jump at all (roll is dropped)
    let mut cam = OrbitCamera::new(100.0, 1.0);
    let eye = Vec3::new(30.0, 20.0, 40.0);
    cam.set_view(eye, Vec3::ZERO, None, 0.4);
    cam.zoom(0.0);
    assert!(vec_close(cam.eye_position(), eye, 1e-3));
    cam.rotate(0.1, 0.0);
    assert!((cam.distance() - eye.length()).abs() < 1e-3);

    // Fly look keeps the eye and moves the target out to the clamped distance
    let mut cam = OrbitCamera::new(100.0, 1.0);
    let (eye, target) = (Vec3::new(0.0, 1.0, 0.3), Vec3::new(0.0, 1.0, 0.0));
    cam.set_view(eye, target, None, 0.0);
    cam.rotate_look(0.0, 0.0);
    assert!(vec_close(cam.eye_position(), eye, 1e-5));
    assert!(vec_close(cam.target(), Vec3::new(0.0, 1.0, -4.7), 1e-4), "{:?}", cam.target());

    // set_target / fit convert too; set_pose replaces the exact pose
    let mut cam = OrbitCamera::new(100.0, 1.0);
    cam.set_view(Vec3::new(0.0, 0.0, 2.0), Vec3::ZERO, None, 0.0);
    cam.set_target(Vec3::X);
    assert!(!cam.is_exact_view() && cam.distance() == 5.0);
    cam.set_view(Vec3::new(0.0, 0.0, 2.0), Vec3::ZERO, None, 0.0);
    cam.set_pose(Vec3::new(0.0, 0.0, 300.0), Vec3::ZERO);
    assert!(!cam.is_exact_view() && cam.distance() == 300.0);
}

#[test]
fn pan_and_move_keep_the_exact_pose() {
    let mut cam = OrbitCamera::new(100.0, 1.0);
    let roll = 30f32.to_radians();
    let (eye, target) = (Vec3::new(0.0, 0.0, 0.2), Vec3::ZERO);
    cam.set_view(eye, target, None, roll);
    let (right, up) = cam.billboard_axes();
    cam.pan(1.0, 2.0);
    assert!(cam.is_exact_view());
    let delta = right + up * 2.0;
    assert!(vec_close(cam.eye_position(), eye + delta, 1e-5));
    assert!(vec_close(cam.target(), target + delta, 1e-5));
    assert!((cam.distance() - 0.2).abs() < 1e-5);
    // Straight down: the fly right axis is the screen right (no degenerate cross with +Y)
    cam.set_view(Vec3::new(0.0, 10.0, 0.0), Vec3::ZERO, None, 0.0);
    cam.move_local(1.0, 1.0, 0.0);
    assert!(cam.is_exact_view());
    assert!(vec_close(cam.eye_position(), Vec3::new(1.0, 9.0, 0.0), 1e-5), "{:?}", cam.eye_position());
}

#[test]
fn frustum_and_orthographic_follow_the_exact_view() {
    let mut cam = OrbitCamera::new(100.0, 1.0);
    cam.set_view(Vec3::new(0.0, 10.0, 0.0), Vec3::ZERO, None, 0.0);
    let f = cam.frustum();
    assert!(f.contains_point(Vec3::ZERO));
    // Behind the camera (above it) is culled; an orbit pose could never see straight down
    assert!(!f.contains_point(Vec3::new(0.0, 20.0, 0.0)));
    cam.set_orthographic(Some(5.0));
    assert!(cam.is_exact_view());
    let a = cam.project_to_ndc(Vec3::new(2.5, 0.0, 0.0)).unwrap();
    assert!((a.x - 0.5).abs() < 1e-4 && a.y.abs() < 1e-4, "{a:?}");
}
