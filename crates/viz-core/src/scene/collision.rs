//! Oriented collision shapes, narrow phase (SAT) and sort-and-sweep broad phase for `SceneWorld`.
//!
//! Shapes per primitive:
//! - Box / custom mesh: oriented box (OBB) of the local bounds.
//! - Cylinder: OBB of its bounds. Exact for flat contacts (upright, stacked, lying on a face);
//!   a cylinder on its side rests on its bounding box and does not roll.
//! - Sphere: sphere of radius `0.5 * max world scale` (non-uniform scale is not an ellipsoid).
//! - Plane: one-sided solid slab under its local `y = 0` surface, as deep as it is half wide, so
//!   fast bodies cannot tunnel through and resting bodies sit exactly on the surface.

use super::{PrimitiveKind, SceneGeometry, SceneObject};
use glam::{Mat4, Vec3};

/// Edge-edge SAT axes win only when clearly shallower than the best face axis (avoids jitter
/// between nearly equal axes on resting contacts).
const EDGE_AXIS_BIAS: f32 = 0.95;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum Shape {
    /// Unit world axes and world half extents along them
    Obb { axes: [Vec3; 3], half: Vec3 },
    Sphere { radius: f32 },
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Collider {
    pub center: Vec3,
    pub shape: Shape,
}

/// Contact between `a` and `b`: `normal` is a unit vector pointing from `a` to `b`, `depth` > 0
/// is how far they must separate along it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Contact {
    pub normal: Vec3,
    pub depth: f32,
}

impl Collider {
    pub fn from_object(obj: &SceneObject, world: &Mat4) -> Self {
        let cols = [world.x_axis.truncate(), world.y_axis.truncate(), world.z_axis.truncate()];
        let scale = Vec3::new(cols[0].length(), cols[1].length(), cols[2].length());
        let fallback = [Vec3::X, Vec3::Y, Vec3::Z];
        let axes: [Vec3; 3] = std::array::from_fn(|i| {
            let a = cols[i].normalize_or_zero();
            if a == Vec3::ZERO { fallback[i] } else { a }
        });
        let origin = world.w_axis.truncate();
        match obj.geometry {
            SceneGeometry::Primitive(PrimitiveKind::Sphere) => Self {
                center: origin,
                shape: Shape::Sphere { radius: 0.5 * scale.max_element() },
            },
            SceneGeometry::Primitive(PrimitiveKind::Plane) => {
                let (hx, hz) = (0.5 * scale.x, 0.5 * scale.z);
                let depth = hx.max(hz).max(0.5);
                Self {
                    center: origin - axes[1] * depth,
                    shape: Shape::Obb { axes, half: Vec3::new(hx, depth, hz) },
                }
            }
            _ => Self {
                center: origin,
                shape: Shape::Obb { axes, half: obj.base_half_extents() * scale },
            },
        }
    }

    /// Half size of the world-aligned bounding box.
    pub fn aabb_half(&self) -> Vec3 {
        match self.shape {
            Shape::Sphere { radius } => Vec3::splat(radius),
            Shape::Obb { axes, half } => {
                axes[0].abs() * half.x + axes[1].abs() * half.y + axes[2].abs() * half.z
            }
        }
    }
}

/// Narrow phase: `None` when separated or merely touching.
pub(crate) fn collide(a: &Collider, b: &Collider) -> Option<Contact> {
    match (a.shape, b.shape) {
        (Shape::Sphere { radius: ra }, Shape::Sphere { radius: rb }) => {
            let d = b.center - a.center;
            let dist = d.length();
            let depth = ra + rb - dist;
            if depth <= 0.0 {
                return None;
            }
            let normal = if dist > 1e-6 { d / dist } else { Vec3::Y };
            Some(Contact { normal, depth })
        }
        (Shape::Obb { axes, half }, Shape::Sphere { radius }) => {
            obb_sphere(a.center, &axes, half, b.center, radius)
        }
        (Shape::Sphere { radius }, Shape::Obb { axes, half }) => {
            obb_sphere(b.center, &axes, half, a.center, radius)
                .map(|c| Contact { normal: -c.normal, ..c })
        }
        (Shape::Obb { axes: aa, half: ha }, Shape::Obb { axes: ba, half: hb }) => {
            obb_obb(a.center, &aa, ha, b.center, &ba, hb)
        }
    }
}

/// Box-to-sphere contact (normal from the box towards the sphere).
fn obb_sphere(bc: Vec3, axes: &[Vec3; 3], half: Vec3, sc: Vec3, radius: f32) -> Option<Contact> {
    let rel = sc - bc;
    let local = Vec3::new(rel.dot(axes[0]), rel.dot(axes[1]), rel.dot(axes[2]));
    let clamped = local.clamp(-half, half);
    if clamped != local {
        let closest = bc + axes[0] * clamped.x + axes[1] * clamped.y + axes[2] * clamped.z;
        let d = sc - closest;
        let dist = d.length();
        if dist > 1e-6 {
            let depth = radius - dist;
            return (depth > 0.0).then(|| Contact { normal: d / dist, depth });
        }
    }
    // Center inside (or on) the box: push out through the nearest face
    let gap = half - local.abs();
    let i = if gap.x <= gap.y && gap.x <= gap.z {
        0
    } else if gap.y <= gap.z {
        1
    } else {
        2
    };
    let sign = if local[i] >= 0.0 { 1.0 } else { -1.0 };
    Some(Contact { normal: axes[i] * sign, depth: radius + gap[i] })
}

/// Separating-axis test over the 15 OBB axes; the contact is the axis of least penetration.
fn obb_obb(ac: Vec3, aa: &[Vec3; 3], ha: Vec3, bc: Vec3, ba: &[Vec3; 3], hb: Vec3) -> Option<Contact> {
    let d = bc - ac;
    let overlap_on = |axis: Vec3| -> f32 {
        let ra = ha.x * aa[0].dot(axis).abs() + ha.y * aa[1].dot(axis).abs() + ha.z * aa[2].dot(axis).abs();
        let rb = hb.x * ba[0].dot(axis).abs() + hb.y * ba[1].dot(axis).abs() + hb.z * ba[2].dot(axis).abs();
        ra + rb - d.dot(axis).abs()
    };
    let mut best_depth = f32::INFINITY;
    let mut best_axis = Vec3::Y;
    for &axis in aa.iter().chain(ba.iter()) {
        let depth = overlap_on(axis);
        if depth <= 0.0 {
            return None;
        }
        if depth < best_depth {
            best_depth = depth;
            best_axis = axis;
        }
    }
    let face_depth = best_depth;
    for ea in aa {
        for eb in ba {
            let c = ea.cross(*eb);
            let len = c.length();
            if len < 1e-3 {
                continue; // near-parallel edges: covered by the face axes
            }
            let axis = c / len;
            let depth = overlap_on(axis);
            if depth <= 0.0 {
                return None;
            }
            if depth < best_depth && depth < face_depth * EDGE_AXIS_BIAS {
                best_depth = depth;
                best_axis = axis;
            }
        }
    }
    let normal = if d.dot(best_axis) < 0.0 { -best_axis } else { best_axis };
    Some(Contact { normal, depth: best_depth })
}

/// World AABB `(min, max)` of each collider, grown by `margin`.
pub(crate) fn aabbs(colliders: &[Collider], margin: f32, out: &mut Vec<(Vec3, Vec3)>) {
    out.clear();
    out.extend(colliders.iter().map(|c| {
        let h = c.aabb_half() + Vec3::splat(margin);
        (c.center - h, c.center + h)
    }));
}

/// Candidate filter shared by the sweep and the brute-force reference: one side must move, and
/// bodies of the same hierarchy (same root) never collide with each other.
fn wants_pair(i: usize, j: usize, dynamic: &[bool], group: &[usize]) -> bool {
    (dynamic[i] || dynamic[j]) && group[i] != group[j]
}

fn overlaps(a: &(Vec3, Vec3), b: &(Vec3, Vec3)) -> bool {
    a.0.cmple(b.1).all() && b.0.cmple(a.1).all()
}

/// Sort-and-sweep on x. `out` gets every overlapping candidate pair `(i, j)` with `i < j`, sorted,
/// so the solver visits pairs in the same order as an `i < j` double loop (deterministic).
pub(crate) fn sweep_pairs(
    boxes: &[(Vec3, Vec3)],
    dynamic: &[bool],
    group: &[usize],
    order: &mut Vec<usize>,
    out: &mut Vec<(usize, usize)>,
) {
    order.clear();
    order.extend(0..boxes.len());
    order.sort_by(|&a, &b| boxes[a].0.x.total_cmp(&boxes[b].0.x).then(a.cmp(&b)));
    out.clear();
    for (k, &i) in order.iter().enumerate() {
        for &j in &order[k + 1..] {
            if boxes[j].0.x > boxes[i].1.x {
                break;
            }
            if wants_pair(i, j, dynamic, group) && overlaps(&boxes[i], &boxes[j]) {
                out.push((i.min(j), i.max(j)));
            }
        }
    }
    out.sort_unstable();
}

/// O(M^2) reference for `sweep_pairs`.
#[cfg(test)]
pub(crate) fn brute_force_pairs(boxes: &[(Vec3, Vec3)], dynamic: &[bool], group: &[usize]) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    for i in 0..boxes.len() {
        for j in (i + 1)..boxes.len() {
            if wants_pair(i, j, dynamic, group) && overlaps(&boxes[i], &boxes[j]) {
                out.push((i, j));
            }
        }
    }
    out
}
