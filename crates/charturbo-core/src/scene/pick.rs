//! Ray picking helpers: analytic primitive tests and the scene-level world-AABB cull.

use crate::spatial::Ray;
use glam::{Mat4, Vec3, Vec4};

/// Solid unit cylinder (radius 0.5, `y` in `[-0.5, 0.5]`, caps included). Same convention as
/// the box test: the entry `t` when the origin is outside, else the exit `t`.
pub(crate) fn intersect_local_cylinder(origin: Vec3, dir: Vec3) -> Option<f32> {
    const R: f32 = 0.5;
    const HALF_H: f32 = 0.5;
    // Caps: slab |y| <= HALF_H
    let (mut tmin, mut tmax) = if dir.y.abs() < 1e-6 {
        if origin.y.abs() > HALF_H {
            return None;
        }
        (f32::NEG_INFINITY, f32::INFINITY)
    } else {
        let inv = 1.0 / dir.y;
        let (t1, t2) = ((-HALF_H - origin.y) * inv, (HALF_H - origin.y) * inv);
        (t1.min(t2), t1.max(t2))
    };
    // Side: x^2 + z^2 <= R^2
    let a = dir.x * dir.x + dir.z * dir.z;
    let c = origin.x * origin.x + origin.z * origin.z - R * R;
    if a < 1e-12 {
        // Parallel to the axis: inside the disc for every t, or never
        if c > 0.0 {
            return None;
        }
    } else {
        let b = origin.x * dir.x + origin.z * dir.z;
        let disc = b * b - a * c;
        if disc < 0.0 {
            return None;
        }
        let sq = disc.sqrt();
        tmin = tmin.max((-b - sq) / a);
        tmax = tmax.min((-b + sq) / a);
    }
    if tmin > tmax || tmax < 0.0 {
        None
    } else if tmin >= 0.0 {
        Some(tmin)
    } else {
        Some(tmax)
    }
}

/// `true` when the world-space AABB of an object (local box `±local_half` mapped by
/// `world`) proves `ray` cannot hit it at `t <= best_t`. Conservative: padded, and it never
/// culls when the transform or ray is non-finite / non-affine, so picks are unchanged.
pub(crate) fn culled_by_world_bounds(
    world: &Mat4,
    local_half: Vec3,
    ray: &Ray,
    best_t: f32,
) -> bool {
    if world.row(3) != Vec4::W {
        return false;
    }
    let center = world.w_axis.truncate();
    let half = world.x_axis.truncate().abs() * local_half.x
        + world.y_axis.truncate().abs() * local_half.y
        + world.z_axis.truncate().abs() * local_half.z;
    let (o, d) = (ray.origin, ray.direction);
    let dir_len = d.length();
    if !(center.is_finite()
        && half.is_finite()
        && o.is_finite()
        && d.is_finite()
        && dir_len > 1e-12)
    {
        return false;
    }
    // Distance-scale slack for the rounding of the exact (inverse-matrix) object tests.
    let magnitude = center.abs().max_element() + half.max_element() + o.abs().max_element() + 1.0;
    let half = half + Vec3::splat(magnitude * 1e-4);
    let tol = magnitude * 1e-3 / dir_len;
    let (mut tmin, mut tmax) = (f32::NEG_INFINITY, f32::INFINITY);
    for axis in 0..3 {
        let (lo, hi) = (center[axis] - half[axis], center[axis] + half[axis]);
        if d[axis].abs() < 1e-30 {
            if o[axis] < lo || o[axis] > hi {
                return true;
            }
            continue;
        }
        let inv = 1.0 / d[axis];
        let (t1, t2) = ((lo - o[axis]) * inv, (hi - o[axis]) * inv);
        tmin = tmin.max(t1.min(t2));
        tmax = tmax.min(t1.max(t2));
    }
    tmin > tmax + tol || tmax < -tol || tmin > best_t + tol
}
