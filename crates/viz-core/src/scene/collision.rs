//! Oriented collision shapes, narrow phase (SAT) and sort-and-sweep broad phase for `SceneWorld`.
//!
//! Shapes per primitive:
//! - Box / custom mesh: oriented box (OBB) of the local bounds.
//! - Cylinder: OBB of its bounds. Angular response is supported, but its curved surface is
//!   still approximated by a box (so a cylinder tumbles rather than rolling smoothly).
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
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Contact {
    pub normal: Vec3,
    pub depth: f32,
    /// World-space contact manifold, midway between the two penetrating surfaces.
    pub points: Vec<Vec3>,
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
            Some(Contact { normal, depth, points: vec![a.center + normal * (ra - depth * 0.5)] })
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
            return (depth > 0.0).then(|| Contact {
                normal: d / dist,
                depth,
                points: vec![closest - d / dist * (depth * 0.5)],
            });
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
    let normal = axes[i] * sign;
    let depth = radius + gap[i];
    Some(Contact { normal, depth, points: vec![sc + normal * (gap[i] - depth * 0.5)] })
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
    let mut face = 0;
    let mut edge = None;
    for (i, &axis) in aa.iter().chain(ba.iter()).enumerate() {
        let depth = overlap_on(axis);
        if depth <= 0.0 {
            return None;
        }
        if depth < best_depth {
            best_depth = depth;
            best_axis = axis;
            face = i;
        }
    }
    let face_depth = best_depth;
    for (i, ea) in aa.iter().enumerate() {
        for (j, eb) in ba.iter().enumerate() {
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
                edge = Some((i, j));
            }
        }
    }
    let normal = if d.dot(best_axis) < 0.0 { -best_axis } else { best_axis };
    let points = if let Some((i, j)) = edge {
        // The supporting edges, not arbitrary corners, determine the torque arm.
        let a = support_edge(ac, aa, ha, normal, i);
        let b = support_edge(bc, ba, hb, -normal, j);
        vec![closest_edge_midpoint(a, b)]
    } else if face < 3 {
        face_contacts(ac, aa, ha, face, normal, bc, ba, hb)
    } else {
        face_contacts(bc, ba, hb, face - 3, -normal, ac, aa, ha)
    };
    Some(Contact { normal, depth: best_depth, points })
}

/// Clip the incident face to the four side planes of the reference face. Multiple contact
/// points let a flat box support its weight without introducing an arbitrary corner torque.
#[allow(clippy::too_many_arguments)]
fn face_contacts(rc: Vec3, ra: &[Vec3; 3], rh: Vec3, face: usize, n: Vec3,
                 ic: Vec3, ia: &[Vec3; 3], ih: Vec3) -> Vec<Vec3> {
    let incident = (0..3).max_by(|&a, &b| ia[a].dot(n).abs().total_cmp(&ia[b].dot(n).abs())).unwrap();
    let center = ic - ia[incident] * ih[incident] * ia[incident].dot(n).signum();
    let u = ia[(incident + 1) % 3] * ih[(incident + 1) % 3];
    let v = ia[(incident + 2) % 3] * ih[(incident + 2) % 3];
    let mut polygon = vec![center - u - v, center + u - v, center + u + v, center - u + v];
    for axis in 0..3 {
        if axis == face { continue; }
        for sign in [-1.0, 1.0] {
            let side = ra[axis] * sign;
            let input = std::mem::take(&mut polygon);
            if input.is_empty() { break; }
            let mut prev = *input.last().unwrap();
            let mut prev_d = (prev - rc).dot(side) - rh[axis];
            for curr in input {
                let curr_d = (curr - rc).dot(side) - rh[axis];
                if (prev_d <= 0.0) != (curr_d <= 0.0) {
                    polygon.push(prev + (curr - prev) * (prev_d / (prev_d - curr_d)));
                }
                if curr_d <= 0.0 { polygon.push(curr); }
                prev = curr;
                prev_d = curr_d;
            }
        }
    }
    let plane = rc + n * rh[face];
    polygon.into_iter().filter_map(|p| {
        let separation = (p - plane).dot(n);
        (separation <= 1e-5).then_some(p - n * separation * 0.5)
    }).collect()
}

fn support_edge(c: Vec3, axes: &[Vec3; 3], half: Vec3, n: Vec3, edge: usize) -> (Vec3, Vec3) {
    let mut center = c;
    for i in 0..3 {
        if i != edge { center += axes[i] * half[i] * axes[i].dot(n).signum(); }
    }
    (center - axes[edge] * half[edge], center + axes[edge] * half[edge])
}

fn closest_edge_midpoint(a: (Vec3, Vec3), b: (Vec3, Vec3)) -> Vec3 {
    let u = a.1 - a.0;
    let v = b.1 - b.0;
    let w = a.0 - b.0;
    let (uu, vv, uv, uw, vw) = (u.dot(u), v.dot(v), u.dot(v), u.dot(w), v.dot(w));
    let denom = uu * vv - uv * uv;
    let mut s = if denom > 1e-12 { ((uv * vw - vv * uw) / denom).clamp(0.0, 1.0) } else { 0.0 };
    let t = ((uv * s + vw) / vv.max(1e-12)).clamp(0.0, 1.0);
    s = ((uv * t - uw) / uu.max(1e-12)).clamp(0.0, 1.0);
    (a.0 + u * s + b.0 + v * t) * 0.5
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
