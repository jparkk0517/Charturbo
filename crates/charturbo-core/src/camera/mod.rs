use crate::spatial::{Frustum, Plane, Ray};
use glam::{Mat4, Vec3, Vec4};

/// Spherical orbit camera managing 3D viewpoint, projection, billboard axes, and screen-to-ray picking.
#[derive(Debug, Clone)]
pub struct OrbitCamera {
    target: Vec3,
    distance: f32,
    yaw: f32,
    pitch: f32,
    fov_y_radians: f32,
    aspect: f32,
    z_near: f32,
    z_far: f32,
    ortho_size: Option<f32>,
}

impl OrbitCamera {
    pub fn new(distance: f32, aspect: f32) -> Self {
        Self {
            target: Vec3::ZERO,
            distance: distance.max(1.0),
            yaw: 0.4,
            pitch: 0.3,
            fov_y_radians: 45.0_f32.to_radians(),
            aspect: aspect.max(0.1),
            z_near: 0.5,
            z_far: 2000.0,
            ortho_size: None,
        }
    }

    #[inline]
    pub fn target(&self) -> Vec3 {
        self.target
    }

    #[inline]
    pub fn set_target(&mut self, target: Vec3) {
        self.target = target;
    }

    #[inline]
    pub fn distance(&self) -> f32 {
        self.distance
    }

    #[inline]
    pub fn yaw(&self) -> f32 {
        self.yaw
    }

    #[inline]
    pub fn pitch(&self) -> f32 {
        self.pitch
    }

    #[inline]
    pub fn fov_y(&self) -> f32 {
        self.fov_y_radians
    }

    /// Sets the vertical field of view in degrees, clamped to 10..=120; non-finite values are ignored.
    pub fn set_fov_y_degrees(&mut self, degrees: f32) {
        if degrees.is_finite() {
            self.fov_y_radians = degrees.clamp(10.0, 120.0).to_radians();
        }
    }

    #[inline]
    pub fn set_distance(&mut self, distance: f32) {
        self.distance = distance.clamp(5.0, 5000.0);
    }

    pub fn eye_position(&self) -> Vec3 {
        let cos_p = self.pitch.cos();
        let sin_p = self.pitch.sin();
        let cos_y = self.yaw.cos();
        let sin_y = self.yaw.sin();

        let offset = Vec3::new(
            self.distance * cos_p * sin_y,
            self.distance * sin_p,
            self.distance * cos_p * cos_y,
        );
        self.target + offset
    }

    pub fn rotate(&mut self, delta_yaw: f32, delta_pitch: f32) {
        self.yaw += delta_yaw;
        let limit = std::f32::consts::FRAC_PI_2 - 0.05;
        self.pitch = (self.pitch + delta_pitch).clamp(-limit, limit);
    }

    pub fn zoom(&mut self, delta: f32) {
        let next = (self.distance + delta).clamp(5.0, 5000.0);
        if let Some(size) = &mut self.ortho_size { *size *= next / self.distance; }
        self.distance = next;
    }

    /// Orthographic vertical half-extent in world units; None restores perspective.
    pub fn set_orthographic(&mut self, size: Option<f32>) {
        self.ortho_size = size.filter(|s| s.is_finite() && *s > 0.);
    }
    pub fn orthographic_size(&self) -> Option<f32> { self.ortho_size }

    /// Translates `target` along the camera's local right and up axes.
    pub fn pan(&mut self, delta_right: f32, delta_up: f32) {
        let (right, up) = self.billboard_axes();
        self.target += right * delta_right + up * delta_up;
    }

    /// Moves both camera eye and target in camera-relative directions (WASD / Fly navigation).
    pub fn move_local(&mut self, forward_delta: f32, right_delta: f32, up_delta: f32) {
        let eye = self.eye_position();
        let forward = (self.target - eye).normalize_or_zero();
        let right = forward.cross(Vec3::Y).normalize_or_zero();
        self.target += forward * forward_delta + right * right_delta + Vec3::Y * up_delta;
    }

    /// Rotates camera look direction around the current `eye_position` (First-Person / Fly mouse look).
    pub fn rotate_look(&mut self, delta_yaw: f32, delta_pitch: f32) {
        let eye = self.eye_position();
        self.yaw += delta_yaw;
        let limit = std::f32::consts::FRAC_PI_2 - 0.05;
        self.pitch = (self.pitch + delta_pitch).clamp(-limit, limit);

        let cos_p = self.pitch.cos();
        let sin_p = self.pitch.sin();
        let cos_y = self.yaw.cos();
        let sin_y = self.yaw.sin();
        let offset = Vec3::new(
            self.distance * cos_p * sin_y,
            self.distance * sin_p,
            self.distance * cos_p * cos_y,
        );
        self.target = eye - offset;
    }

    /// Explicitly positions the camera at `eye` looking at `target`.
    pub fn set_pose(&mut self, eye: Vec3, target: Vec3) {
        self.target = target;
        let offset = eye - target;
        let dist = offset.length().clamp(5.0, 5000.0);
        self.distance = dist;
        let dir = offset / dist;
        let limit = std::f32::consts::FRAC_PI_2 - 0.05;
        self.pitch = dir.y.clamp(-0.99, 0.99).asin().clamp(-limit, limit);
        self.yaw = dir.x.atan2(dir.z);
    }

    /// Centers camera on `center` and adjusts distance so a bounding sphere of `radius` fits in view.
    pub fn fit_to_bounds(&mut self, center: Vec3, radius: f32) {
        self.target = center;
        let half_fov = (self.fov_y_radians * 0.5).max(0.1);
        let required_dist = (radius.max(1.0) / half_fov.sin()) * 1.18;
        self.distance = required_dist.clamp(5.0, 5000.0);
        self.z_far = (self.distance + radius * 3.0).max(2000.0);
        if self.ortho_size.is_some() { self.ortho_size = Some(radius.max(1.) * 1.18 / self.aspect.min(1.)); }
    }

    /// Centers the camera on `center` and, keeping the view direction, sets the smallest distance at
    /// which every point projects inside `margin` (1.0 = edge to edge) of the view on both axes:
    /// each point is checked against the vertical and the horizontal FOV, so content fills wide
    /// and tall viewports alike (a bounding-sphere fit leaves wide views mostly empty).
    /// `radius` (bounding sphere) only sizes the far plane. No points: `fit_to_bounds`.
    pub fn fit_to_points(&mut self, center: Vec3, points: impl IntoIterator<Item = Vec3>, radius: f32, margin: f32) {
        self.target = center;
        let (right, up) = self.billboard_axes();
        let back = (self.eye_position() - center).normalize_or_zero();
        let tan_y = (self.fov_y_radians * 0.5).tan().max(1e-3) * margin.max(0.05);
        let tan_x = tan_y * self.aspect;
        let mut dist = f32::NEG_INFINITY;
        let mut extent = 0.0_f32;
        for p in points {
            let v = p - center;
            // Depth from the eye is `dist - z`: |x| <= (dist - z) * tan_x, |y| <= (dist - z) * tan_y
            let z = v.dot(back);
            extent = extent.max((v.dot(right).abs() / self.aspect).max(v.dot(up).abs()) / margin.max(0.05));
            let need = (v.dot(right).abs() / tan_x).max(v.dot(up).abs() / tan_y);
            // Keep the point clear of the near plane too
            dist = dist.max(z + need.max(self.z_near * 2.0));
        }
        if !dist.is_finite() {
            self.fit_to_bounds(center, radius);
            return;
        }
        self.distance = dist.clamp(5.0, 5000.0);
        self.z_far = (self.distance + radius * 3.0).max(2000.0);
        if self.ortho_size.is_some() { self.ortho_size = Some(extent.max(1e-3)); }
    }

    /// Camera distance at which a `width × height` rectangle facing the camera fills the view,
    /// scaled by `margin` (1.0 = edge to edge).
    pub fn distance_to_fit_rect(&self, width: f32, height: f32, margin: f32) -> f32 {
        let tan_half = (self.fov_y_radians * 0.5).tan().max(1e-3);
        let by_height = height.max(1e-3) * 0.5 / tan_half;
        let by_width = width.max(1e-3) * 0.5 / (tan_half * self.aspect);
        (by_height.max(by_width) * margin).clamp(5.0, 5000.0)
    }

    /// Camera distance at which `visible_height` world units span the full vertical view.
    pub fn distance_for_visible_height(&self, visible_height: f32) -> f32 {
        let tan_half = (self.fov_y_radians * 0.5).tan().max(1e-3);
        (visible_height.max(1e-3) * 0.5 / tan_half).clamp(5.0, 5000.0)
    }

    pub fn aspect(&self) -> f32 {
        self.aspect
    }

    pub fn set_aspect(&mut self, width: f32, height: f32) {
        if height > 0.0 {
            self.aspect = (width / height).max(0.05);
        }
    }

    pub fn view_matrix(&self) -> Mat4 {
        Mat4::look_at_rh(self.eye_position(), self.target, Vec3::Y)
    }

    pub fn projection_matrix(&self) -> Mat4 {
        if let Some(h) = self.ortho_size {
            return Mat4::orthographic_rh(-h * self.aspect, h * self.aspect, -h, h, self.z_far, self.z_near);
        }
        // Reversed-Z (near -> 1, far -> 0): with a float depth buffer this spreads precision
        // evenly over distance and removes z-fighting on large scenes
        Mat4::perspective_rh(self.fov_y_radians, self.aspect, self.z_far, self.z_near)
    }

    pub fn view_proj_matrix(&self) -> Mat4 {
        self.projection_matrix() * self.view_matrix()
    }

    /// Extracts the 6-plane world-space viewing frustum for the current camera state.
    pub fn frustum(&self) -> Frustum {
        Frustum::from_view_proj(self.view_proj_matrix())
    }

    /// Constructs a world-space `Frustum` corresponding to a 2D NDC rectangle `[min_x, min_y] .. [max_x, max_y]`.
    pub fn sub_frustum_from_ndc_box(
        &self,
        min_ndc_x: f32,
        min_ndc_y: f32,
        max_ndc_x: f32,
        max_ndc_y: f32,
    ) -> Frustum {
        let x0 = min_ndc_x.min(max_ndc_x);
        let x1 = min_ndc_x.max(max_ndc_x);
        let y0 = min_ndc_y.min(max_ndc_y);
        let y1 = min_ndc_y.max(max_ndc_y);

        let vp = self.view_proj_matrix();
        let r0 = vp.row(0);
        let r1 = vp.row(1);
        let r2 = vp.row(2);
        let r3 = vp.row(3);

        // Clip space condition: x0 * w <= x <= x1 * w  =>  x - x0*w >= 0  and  x1*w - x >= 0
        Frustum {
            planes: [
                Plane::from_vec4(r0 - r3 * x0), // Left
                Plane::from_vec4(r3 * x1 - r0), // Right
                Plane::from_vec4(r1 - r3 * y0), // Bottom
                Plane::from_vec4(r3 * y1 - r1), // Top
                Plane::from_vec4(r2),           // Depth >= 0 (far plane with reversed-Z)
                Plane::from_vec4(r3 - r2),      // Depth <= 1 (near plane with reversed-Z)
            ],
        }
    }

    /// Projects a world-space position into Normalized Device Coordinates `(ndc_x, ndc_y, ndc_z)`.
    /// Returns `None` if the point is behind the camera near plane.
    pub fn project_to_ndc(&self, world_pos: Vec3) -> Option<Vec3> {
        let clip = self.view_proj_matrix() * Vec4::new(world_pos.x, world_pos.y, world_pos.z, 1.0);
        if clip.w <= 0.0 {
            return None;
        }
        let ndc = clip.truncate() / clip.w;
        if ndc.z < 0.0 || ndc.z > 1.0 {
            return None;
        }
        Some(ndc)
    }

    /// Returns unit `(right, up)` vectors in world space for spherical billboard impostor rendering.
    pub fn billboard_axes(&self) -> (Vec3, Vec3) {
        let forward = (self.target - self.eye_position()).normalize_or_zero();
        let right = forward.cross(Vec3::Y).normalize_or_zero();
        let up = right.cross(forward).normalize_or_zero();
        (right, up)
    }

    /// Unprojects normalized device coordinates `ndc_x, ndc_y` in `[-1, 1]` into a world-space `Ray`.
    pub fn screen_to_ray(&self, ndc_x: f32, ndc_y: f32) -> Ray {
        let inv_vp = self.view_proj_matrix().inverse();
        // Reversed-Z: depth 1 is the near plane, 0 the far plane
        let near_clip = Vec4::new(ndc_x, ndc_y, 1.0, 1.0);
        let far_clip = Vec4::new(ndc_x, ndc_y, 0.0, 1.0);

        let near_world4 = inv_vp * near_clip;
        let far_world4 = inv_vp * far_clip;

        let near_world = near_world4.truncate() / near_world4.w;
        let far_world = far_world4.truncate() / far_world4.w;

        Ray::new(if self.ortho_size.is_some() { near_world } else { self.eye_position() }, far_world - near_world)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn orthographic_rays_are_parallel_and_zoom_changes_scale_not_depth() {
        let mut cam = OrbitCamera::new(300., 2.);
        cam.set_pose(Vec3::new(0., 0., 300.), Vec3::ZERO);
        cam.set_orthographic(Some(100.));
        let a = cam.project_to_ndc(Vec3::new(40., 20., 0.)).unwrap();
        let b = cam.project_to_ndc(Vec3::new(40., 20., 100.)).unwrap();
        assert!((a.x - b.x).abs() < 1e-5 && (a.y - b.y).abs() < 1e-5);
        let r0 = cam.screen_to_ray(0., 0.); let r1 = cam.screen_to_ray(a.x, a.y);
        assert!((r0.direction - r1.direction).length() < 1e-5);
        assert!((r1.origin.x - 40.).abs() < 1e-3 && (r1.origin.y - 20.).abs() < 1e-3);
        cam.zoom(-150.);
        assert!((cam.project_to_ndc(Vec3::new(40., 20., 0.)).unwrap().x - a.x * 2.).abs() < 1e-4);
        cam.set_aspect(300., 600.);
        assert!(cam.project_to_ndc(Vec3::new(0., 20., 0.)).is_some());
        cam.set_orthographic(None);
        assert_ne!(cam.project_to_ndc(Vec3::new(40., 20., 0.)).unwrap().x, cam.project_to_ndc(Vec3::new(40., 20., 100.)).unwrap().x);
    }

    #[test]
    fn fov_setter_clamps_and_ignores_non_finite() {
        let mut cam = OrbitCamera::new(100.0, 1.0);
        cam.set_fov_y_degrees(60.0);
        assert!((cam.fov_y() - 60f32.to_radians()).abs() < 1e-6);
        cam.set_fov_y_degrees(1.0);
        assert!((cam.fov_y() - 10f32.to_radians()).abs() < 1e-6);
        cam.set_fov_y_degrees(500.0);
        assert!((cam.fov_y() - 120f32.to_radians()).abs() < 1e-6);
        cam.set_fov_y_degrees(75.0);
        for bad in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            cam.set_fov_y_degrees(bad);
            assert!((cam.fov_y() - 75f32.to_radians()).abs() < 1e-6);
        }
    }

    #[test]
    fn fov_change_alters_projection() {
        let mut cam = OrbitCamera::new(300., 1.);
        cam.set_pose(Vec3::new(0., 0., 300.), Vec3::ZERO);
        let p = Vec3::new(0., 40., 0.);
        let before = cam.project_to_ndc(p).unwrap().y;
        cam.set_fov_y_degrees(90.0);
        let after = cam.project_to_ndc(p).unwrap().y;
        // Wider FOV shrinks the projected offset by tan(22.5deg)/tan(45deg)
        assert!(after < before * 0.5);
        assert!((after / before - 22.5f32.to_radians().tan() / 45f32.to_radians().tan()).abs() < 1e-3);
    }

    #[test]
    fn camera_pitch_is_clamped_to_avoid_gimbal_lock() {
        let mut cam = OrbitCamera::new(100.0, 16.0 / 9.0);
        cam.rotate(0.0, 100.0); // huge upward pitch
        let eye = cam.eye_position();
        assert!(eye.is_finite());
        // Should never become exactly collinear with Y axis
        let dir = (cam.target - eye).normalize();
        assert!(dir.y.abs() < 0.999);
    }

    #[test]
    fn camera_billboard_axes_are_orthonormal_and_perpendicular_to_view_dir() {
        let mut cam = OrbitCamera::new(120.0, 1.5);
        cam.rotate(0.8, -0.4);

        let (right, up) = cam.billboard_axes();
        let forward = (cam.target - cam.eye_position()).normalize();

        assert!((right.length() - 1.0).abs() < 1e-5);
        assert!((up.length() - 1.0).abs() < 1e-5);
        assert!(right.dot(up).abs() < 1e-5);
        assert!(right.dot(forward).abs() < 1e-5);
        assert!(up.dot(forward).abs() < 1e-5);
    }

    #[test]
    fn center_screen_ray_points_directly_at_camera_target() {
        let cam = OrbitCamera::new(150.0, 1.6);
        let ray = cam.screen_to_ray(0.0, 0.0);
        let expected_dir = (cam.target - cam.eye_position()).normalize();

        assert!((ray.origin - cam.eye_position()).length() < 1e-3);
        assert!((ray.direction - expected_dir).length() < 1e-4);
    }

    #[test]
    fn fit_to_points_fills_wide_and_tall_views() {
        // A flat 200 x 20 strip facing the camera (yaw 0 / pitch 0: view along -z)
        let pts = [Vec3::new(-100.0, -10.0, 0.0), Vec3::new(100.0, 10.0, 0.0)];
        let mut wide = OrbitCamera::new(100.0, 3.0);
        wide.rotate(-wide.yaw(), -wide.pitch());
        wide.fit_to_points(Vec3::ZERO, pts, 100.5, 0.9);
        for p in pts {
            let ndc = wide.project_to_ndc(p).unwrap();
            assert!(ndc.x.abs() <= 0.9 + 1e-3 && ndc.y.abs() <= 0.9 + 1e-3, "{ndc:?}");
        }
        // The horizontal extent is the binding one: x lands on the margin
        let ndc = wide.project_to_ndc(pts[1]).unwrap();
        assert!((ndc.x - 0.9).abs() < 1e-2, "{ndc:?}");
        // Much closer than the bounding-sphere fit
        let mut sphere = wide.clone();
        sphere.fit_to_bounds(Vec3::ZERO, 100.5);
        assert!(wide.distance() < sphere.distance() * 0.6);

        // A tall viewport fits the same strip by its width (FOV x is the tighter one)
        let mut tall = OrbitCamera::new(100.0, 0.5);
        tall.rotate(-tall.yaw(), -tall.pitch());
        tall.fit_to_points(Vec3::ZERO, pts, 100.5, 0.9);
        let ndc = tall.project_to_ndc(pts[1]).unwrap();
        assert!((ndc.x - 0.9).abs() < 1e-2, "{ndc:?}");
        assert!(tall.distance() > wide.distance());

        // Points toward the camera need extra distance (they project larger)
        let mut deep = wide.clone();
        deep.fit_to_points(Vec3::ZERO, [Vec3::new(100.0, 0.0, 50.0), Vec3::new(-100.0, 0.0, -50.0)], 120.0, 0.9);
        assert!(deep.project_to_ndc(Vec3::new(100.0, 0.0, 50.0)).unwrap().x <= 0.9 + 1e-3);

        // No points: bounding-sphere fit
        let mut empty = OrbitCamera::new(100.0, 1.0);
        empty.fit_to_points(Vec3::ONE, std::iter::empty(), 10.0, 0.9);
        let mut sphere = OrbitCamera::new(100.0, 1.0);
        sphere.fit_to_bounds(Vec3::ONE, 10.0);
        assert_eq!(empty.distance(), sphere.distance());
        assert_eq!(empty.target(), Vec3::ONE);
    }

    #[test]
    fn camera_pan_and_fit_to_bounds_update_target_and_distance() {
        let mut cam = OrbitCamera::new(100.0, 1.0);
        let initial_target = cam.target();
        cam.pan(10.0, -5.0);
        assert_ne!(cam.target(), initial_target);

        let sphere_center = Vec3::new(20.0, -10.0, 5.0);
        cam.fit_to_bounds(sphere_center, 50.0);
        assert_eq!(cam.target(), sphere_center);
        assert!(cam.distance() > 50.0);

        // Projecting target to NDC should map to center (0, 0)
        let ndc = cam.project_to_ndc(sphere_center).unwrap();
        assert!(ndc.x.abs() < 1e-4);
        assert!(ndc.y.abs() < 1e-4);
    }

    #[test]
    fn sub_frustum_from_ndc_box_filters_points_in_screen_quadrant() {
        let mut cam = OrbitCamera::new(100.0, 1.0);
        cam.set_target(Vec3::ZERO);
        // Reset yaw/pitch to look straight from +Z toward origin
        cam = OrbitCamera::new(100.0, 1.0);
        // Point at target (0,0,0) projects to NDC (0,0)
        let center_box = cam.sub_frustum_from_ndc_box(-0.2, -0.2, 0.2, 0.2);
        assert!(center_box.contains_point(cam.target()));

        // Upper-right NDC box [0.3, 0.3] to [0.9, 0.9] should NOT contain camera target (0,0)
        let corner_box = cam.sub_frustum_from_ndc_box(0.3, 0.3, 0.9, 0.9);
        assert!(!corner_box.contains_point(cam.target()));
    }
}
