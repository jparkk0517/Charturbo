use glam::{Mat4, Vec3, Vec4};

/// Normalized 3D plane (`normal.dot(p) + d >= 0` means inside).
#[derive(Debug, Clone, Copy)]
pub struct Plane {
    pub normal: Vec3,
    pub d: f32,
}

impl Plane {
    pub fn from_vec4(v: Vec4) -> Self {
        let n = Vec3::new(v.x, v.y, v.z);
        let len = n.length();
        if len > 1e-6 {
            Self {
                normal: n / len,
                d: v.w / len,
            }
        } else {
            Self {
                normal: Vec3::Z,
                d: 0.0,
            }
        }
    }

    #[inline]
    pub fn distance_to_point(&self, pt: Vec3) -> f32 {
        self.normal.dot(pt) + self.d
    }
}

/// 6-plane viewing or selection frustum in world space.
#[derive(Debug, Clone, Copy)]
pub struct Frustum {
    pub planes: [Plane; 6],
}

impl Frustum {
    /// Gribb-Hartmann extraction of 6 inward-facing frustum planes from a `view_proj` matrix.
    pub fn from_view_proj(m: Mat4) -> Self {
        let r0 = m.row(0);
        let r1 = m.row(1);
        let r2 = m.row(2);
        let r3 = m.row(3);

        Self {
            planes: [
                Plane::from_vec4(r3 + r0), // Left
                Plane::from_vec4(r3 - r0), // Right
                Plane::from_vec4(r3 + r1), // Bottom
                Plane::from_vec4(r3 - r1), // Top
                // Depth clip z/w in [0, 1]; with reversed-Z these are the far / near planes
                Plane::from_vec4(r2),
                Plane::from_vec4(r3 - r2),
            ],
        }
    }

    #[inline]
    pub fn contains_point(&self, pt: Vec3) -> bool {
        for plane in &self.planes {
            if plane.distance_to_point(pt) < 0.0 {
                return false;
            }
        }
        true
    }

    #[inline]
    pub fn intersects_aabb(&self, center: Vec3, half_size: f32) -> bool {
        let extent = Vec3::splat(half_size);
        for plane in &self.planes {
            let r = extent.dot(plane.normal.abs());
            let s = plane.distance_to_point(center);
            if s + r < 0.0 {
                return false;
            }
        }
        true
    }
}

/// Represents a 3D ray for spatial picking and intersection queries.
#[derive(Debug, Clone, Copy)]
pub struct Ray {
    pub origin: Vec3,
    pub direction: Vec3,
}

impl Ray {
    pub fn new(origin: Vec3, direction: Vec3) -> Self {
        Self {
            origin,
            direction: direction.normalize_or_zero(),
        }
    }

    /// Returns `Some(t_near)` if the ray intersects the AABB centered at `center` with `half_size`.
    #[inline]
    pub fn intersects_aabb(&self, center: Vec3, half_size: f32) -> Option<f32> {
        let min_b = center - Vec3::splat(half_size);
        let max_b = center + Vec3::splat(half_size);

        let mut tmin = 0.0f32;
        let mut tmax = f32::MAX;

        for axis in 0..3 {
            let orig = self.origin[axis];
            let dir = self.direction[axis];
            let bmin = min_b[axis];
            let bmax = max_b[axis];

            if dir.abs() < 1e-7 {
                if orig < bmin || orig > bmax {
                    return None;
                }
            } else {
                let inv_d = 1.0 / dir;
                let mut t1 = (bmin - orig) * inv_d;
                let mut t2 = (bmax - orig) * inv_d;
                if t1 > t2 {
                    std::mem::swap(&mut t1, &mut t2);
                }
                tmin = tmin.max(t1);
                tmax = tmax.min(t2);
                if tmin > tmax {
                    return None;
                }
            }
        }
        Some(tmin)
    }
}

/// Lightweight value object representing a body in 3D space for spatial indexing.
#[derive(Debug, Clone, Copy)]
pub struct SpatialBody {
    pub id: u32,
    pub position: Vec3,
    pub mass: f32,
}

/// GPU octree records written by `renderer/gpu_tree.wgsl` (32 bytes each, WGSL layouts).
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct GpuForceCell {
    pub com_mass: [f32; 4],
    pub size_sq: f32,
    pub escape: u32,
    pub body: u32,
    pub pad: u32,
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct GpuForceBody {
    pub position_mass: [f32; 4],
    pub id: u32,
    pub next: u32,
    pub pad: [u32; 2],
}

/// Abstraction for 3D spatial indexing, decoupling physics & picking from concrete tree data structures.
pub trait SpatialIndex {
    /// Rebuilds the spatial index from a slice of bodies.
    fn rebuild(&mut self, bodies: &[SpatialBody]);

    /// Computes repulsive force exerted on `target_pos` by all bodies in the index.
    /// `theta` controls the Barnes-Hut approximation threshold (0.0 = exact O(N^2), ~0.7 = fast O(N log N)).
    fn compute_repulsion(
        &self,
        target_id: u32,
        target_pos: Vec3,
        theta: f32,
        repulsion_strength: f32,
        softening: f32,
    ) -> Vec3;

    /// Finds the closest body id intersected by `ray` within `hit_radius`.
    fn query_ray(&self, ray: &Ray, hit_radius: f32) -> Option<u32>;

    /// Finds up to `max_results` bodies within `radius` of `center`, sorted by distance ascending.
    fn query_sphere(&self, center: Vec3, radius: f32, max_results: usize) -> Vec<u32>;

    /// Appends all body IDs inside `frustum` into `out_ids`.
    fn query_frustum(&self, frustum: &Frustum, out_ids: &mut Vec<u32>);
}

#[derive(Debug, Clone)]
struct OctreeCell {
    center: Vec3,
    half_size: f32,
    mass_weighted_sum: Vec3,
    total_mass: f32,
    body_index: Option<u32>,
    is_internal: bool,
    children: [u32; 8],
}

impl OctreeCell {
    #[inline]
    fn new(center: Vec3, half_size: f32) -> Self {
        Self {
            center,
            half_size,
            mass_weighted_sum: Vec3::ZERO,
            total_mass: 0.0,
            body_index: None,
            is_internal: false,
            children: [0; 8],
        }
    }

    #[inline]
    fn octant_for(&self, pos: Vec3) -> usize {
        let mut idx = 0;
        if pos.x >= self.center.x {
            idx |= 1;
        }
        if pos.y >= self.center.y {
            idx |= 2;
        }
        if pos.z >= self.center.z {
            idx |= 4;
        }
        idx
    }

    #[inline]
    fn child_center(&self, octant: usize) -> Vec3 {
        let step = self.half_size * 0.5;
        Vec3::new(
            self.center.x + if (octant & 1) != 0 { step } else { -step },
            self.center.y + if (octant & 2) != 0 { step } else { -step },
            self.center.z + if (octant & 4) != 0 { step } else { -step },
        )
    }
}

/// Flat-array (arena) based 3D Octree implementing `SpatialIndex` with zero per-frame heap reallocations.
pub struct OctreeSpatialIndex {
    max_depth: u32,
    cells: Vec<OctreeCell>,
    bodies: Vec<SpatialBody>,
    next_in_leaf: Vec<Option<u32>>,
    /// Read-only DFS layout for the hot force traversal. Spatial queries retain the octree.
    force_cells: Vec<ForceCell>,
    /// Largest drawn body radius (pick AABBs are expanded by it)
    max_body_radius: f32,
}

/// Compact, stackless traversal: descend to the next record, or skip to `escape`.
/// COM and squared width are computed once per rebuild, rather than per target/cell pair.
struct ForceCell {
    center_of_mass: Vec3,
    mass: f32,
    size_sq: f32,
    escape: u32,
    body: Option<u32>,
}

/// Traversal stacks hold 96 cells; depth 13 needs at most 7 * 13 + 1 = 92 entries.
const MAX_OCTREE_DEPTH: u32 = 13;

/// Drawn billboard radius of a body (matches the renderer's `mass * 0.95`).
#[inline]
fn body_radius(mass: f32) -> f32 {
    mass * 0.95
}

/// Deterministic unit direction for separating two bodies at the exact same position.
#[inline]
fn coincident_dir(a: u32, b: u32) -> Vec3 {
    // Hash the unordered pair so both bodies agree on the axis; the sign below splits them
    let (lo, hi) = if a < b { (a, b) } else { (b, a) };
    let h = lo.wrapping_mul(0x9E37_79B1) ^ hi.wrapping_mul(0x85EB_CA77);
    let angle = (h % 6283) as f32 * 1e-3;
    let z = ((h >> 13) % 2001) as f32 * 1e-3 - 1.0;
    let r = (1.0 - z * z).max(0.0).sqrt();
    let dir = Vec3::new(r * angle.cos(), r * angle.sin(), z);
    // Opposite ordering of the pair pushes the other way
    if a < b {
        dir
    } else {
        -dir
    }
}

/// Repulsion of one body on `target_pos` (coincident bodies get a tiny deterministic separation).
#[inline]
pub(crate) fn pair_repulsion(target_id: u32, target_pos: Vec3, body: &SpatialBody, strength: f32, softening: f32) -> Vec3 {
    let mut delta = target_pos - body.position;
    let mut len_sq = delta.length_squared();
    if len_sq < 1e-12 {
        delta = coincident_dir(target_id, body.id) * 1e-3;
        len_sq = 1e-6;
    }
    let dist_sq = len_sq + softening;
    let inv_dist = dist_sq.sqrt().recip();
    let force_mag = strength * body.mass / dist_sq;
    delta * (inv_dist * force_mag)
}

impl OctreeSpatialIndex {
    pub fn new(max_depth: u32) -> Self {
        Self {
            max_depth: max_depth.min(MAX_OCTREE_DEPTH),
            max_body_radius: 0.0,
            cells: Vec::with_capacity(4096),
            bodies: Vec::with_capacity(2048),
            next_in_leaf: Vec::with_capacity(2048),
            force_cells: Vec::new(),
        }
    }

    /// Index without preallocated cells / bodies (grown by the first rebuild): engines that
    /// rarely hold a graph (shared-device charts, sparklines) skip the ~300 KB reservation.
    pub fn compact(max_depth: u32) -> Self {
        Self {
            max_depth: max_depth.min(MAX_OCTREE_DEPTH),
            max_body_radius: 0.0,
            cells: Vec::new(),
            bodies: Vec::new(),
            next_in_leaf: Vec::new(),
            force_cells: Vec::new(),
        }
    }

    fn insert_body(&mut self, cell_idx: usize, body_idx: u32, depth: u32) {
        let body = self.bodies[body_idx as usize];
        self.cells[cell_idx].mass_weighted_sum += body.position * body.mass;
        self.cells[cell_idx].total_mass += body.mass;

        if !self.cells[cell_idx].is_internal {
            if self.cells[cell_idx].body_index.is_none() {
                self.cells[cell_idx].body_index = Some(body_idx);
                return;
            }
            if depth >= self.max_depth {
                // Chain into leaf linked list so co-located bodies at max_depth are never lost
                self.next_in_leaf[body_idx as usize] = self.cells[cell_idx].body_index;
                self.cells[cell_idx].body_index = Some(body_idx);
                return;
            }

            // Subdivide leaf into internal node and push existing body down
            let existing_idx = self.cells[cell_idx].body_index.take().unwrap();
            self.cells[cell_idx].is_internal = true;

            let existing_pos = self.bodies[existing_idx as usize].position;
            let existing_oct = self.cells[cell_idx].octant_for(existing_pos);
            let existing_child = self.ensure_child(cell_idx, existing_oct);
            self.insert_body(existing_child, existing_idx, depth + 1);
        }

        let octant = self.cells[cell_idx].octant_for(body.position);
        let child_idx = self.ensure_child(cell_idx, octant);
        self.insert_body(child_idx, body_idx, depth + 1);
    }

    fn compile_force_cell(&mut self, index: usize) {
        let cell = &self.cells[index];
        let children = cell.children;
        let slot = self.force_cells.len();
        self.force_cells.push(ForceCell {
            center_of_mass: cell.mass_weighted_sum / cell.total_mass,
            mass: cell.total_mass,
            size_sq: (cell.half_size * 2.0).powi(2),
            escape: 0,
            body: cell.body_index,
        });
        // Same order as the old LIFO traversal, preserving floating-point force accumulation.
        for child in children.into_iter().rev().filter(|&c| c != 0) {
            self.compile_force_cell(child as usize);
        }
        self.force_cells[slot].escape = self.force_cells.len() as u32;
    }

    #[inline]
    fn ensure_child(&mut self, cell_idx: usize, octant: usize) -> usize {
        let existing = self.cells[cell_idx].children[octant];
        if existing != 0 {
            return existing as usize;
        }
        let child_center = self.cells[cell_idx].child_center(octant);
        let child_half = self.cells[cell_idx].half_size * 0.5;
        let new_idx = self.cells.len();
        self.cells.push(OctreeCell::new(child_center, child_half));
        self.cells[cell_idx].children[octant] = new_idx as u32;
        new_idx
    }

    #[inline]
    fn sphere_intersects_aabb(center: Vec3, radius_sq: f32, aabb_center: Vec3, half_size: f32) -> bool {
        let min_b = aabb_center - Vec3::splat(half_size);
        let max_b = aabb_center + Vec3::splat(half_size);
        let closest = center.clamp(min_b, max_b);
        (center - closest).length_squared() <= radius_sq
    }
}

impl Default for OctreeSpatialIndex {
    fn default() -> Self {
        Self::new(10)
    }
}

impl SpatialIndex for OctreeSpatialIndex {
    fn rebuild(&mut self, bodies: &[SpatialBody]) {
        self.cells.clear();
        self.force_cells.clear();
        self.bodies.clear();
        self.bodies.extend_from_slice(bodies);
        self.next_in_leaf.clear();
        self.next_in_leaf.resize(bodies.len(), None);

        self.max_body_radius = 0.0;
        if bodies.is_empty() {
            return;
        }
        self.max_body_radius = bodies
            .iter()
            .map(|b| body_radius(b.mass))
            .fold(0.0, f32::max);

        let mut min_b = bodies[0].position;
        let mut max_b = bodies[0].position;
        for b in bodies.iter().skip(1) {
            min_b = min_b.min(b.position);
            max_b = max_b.max(b.position);
        }

        let center = (min_b + max_b) * 0.5;
        let extent = (max_b - min_b).max_element() * 0.5 + 1.0;

        self.cells.push(OctreeCell::new(center, extent));
        for i in 0..bodies.len() {
            self.insert_body(0, i as u32, 0);
        }
        self.compile_force_cell(0);
    }

    fn compute_repulsion(
        &self,
        target_id: u32,
        target_pos: Vec3,
        theta: f32,
        repulsion_strength: f32,
        softening: f32,
    ) -> Vec3 {
        if self.cells.is_empty() {
            return Vec3::ZERO;
        }

        // Exact direct summation path when theta <= 0.0
        if theta <= 0.0 {
            let mut total_force = Vec3::ZERO;
            for b in &self.bodies {
                if b.id == target_id {
                    continue;
                }
                total_force += pair_repulsion(target_id, target_pos, b, repulsion_strength, softening);
            }
            return total_force;
        }

        let theta_sq = theta * theta;
        let mut total_force = Vec3::ZERO;
        let mut index = 0;
        while index < self.force_cells.len() {
            let cell = &self.force_cells[index];
            if cell.mass <= 0.0 {
                index = cell.escape as usize;
                continue;
            }
            if cell.body.is_some() {
                let mut cur = cell.body;
                while let Some(b_idx) = cur {
                    let body = &self.bodies[b_idx as usize];
                    if body.id != target_id {
                        total_force +=
                            pair_repulsion(target_id, target_pos, body, repulsion_strength, softening);
                    }
                    cur = self.next_in_leaf[b_idx as usize];
                }
                index = cell.escape as usize;
                continue;
            }

            let delta = target_pos - cell.center_of_mass;
            let dist_sq = delta.length_squared();

            // Note: with theta > 1/sqrt(3) a cell containing the target can in theory pass this
            // test (target and COM in opposite corners). It never occurred in 92M accepted cells
            // on a 50k-node layout, while guarding it cost 5-45% of the step, so it is not checked.
            if cell.size_sq < theta_sq * dist_sq {
                let eff_dist_sq = dist_sq + softening;
                let inv_dist = eff_dist_sq.sqrt().recip();
                let force_mag = repulsion_strength * cell.mass / eff_dist_sq;
                total_force += delta * (inv_dist * force_mag);
                index = cell.escape as usize;
            } else {
                index += 1;
            }
        }

        total_force
    }

    fn query_ray(&self, ray: &Ray, hit_radius: f32) -> Option<u32> {
        if self.cells.is_empty() {
            return None;
        }

        // Pick radius per body = max(hit_radius, drawn radius), so large nodes are hittable everywhere
        let max_pick = hit_radius.max(self.max_body_radius);
        let mut closest_id = None;
        let mut closest_t = f32::MAX;

        let mut stack = [0u32; 96];
        let mut sp = 1usize;
        stack[0] = 0;

        while sp > 0 {
            sp -= 1;
            let cell = &self.cells[stack[sp] as usize];
            if cell.total_mass <= 0.0 {
                continue;
            }

            // Expand AABB by hit_radius so rays grazing a body near cell boundary are not pruned
            match ray.intersects_aabb(cell.center, cell.half_size + max_pick) {
                Some(t_near) if t_near <= closest_t => {}
                _ => continue,
            }

            if !cell.is_internal {
                let mut cur = cell.body_index;
                while let Some(b_idx) = cur {
                    let b = &self.bodies[b_idx as usize];
                    let to_body = b.position - ray.origin;
                    let t = to_body.dot(ray.direction);
                    if t >= 0.0 && t < closest_t {
                        let closest_pt = ray.origin + ray.direction * t;
                        let dist_sq = (b.position - closest_pt).length_squared();
                        let r = hit_radius.max(body_radius(b.mass));
                        if dist_sq <= r * r {
                            closest_t = t;
                            closest_id = Some(b.id);
                        }
                    }
                    cur = self.next_in_leaf[b_idx as usize];
                }
            } else {
                for &child_idx in &cell.children {
                    if child_idx != 0 && sp < stack.len() {
                        stack[sp] = child_idx;
                        sp += 1;
                    }
                }
            }
        }

        closest_id
    }

    fn query_sphere(&self, center: Vec3, radius: f32, max_results: usize) -> Vec<u32> {
        if self.cells.is_empty() || max_results == 0 || radius <= 0.0 {
            return Vec::new();
        }

        let radius_sq = radius * radius;
        let mut hits: Vec<(f32, u32)> = Vec::new();

        let mut stack = [0u32; 96];
        let mut sp = 1usize;
        stack[0] = 0;

        while sp > 0 {
            sp -= 1;
            let cell = &self.cells[stack[sp] as usize];
            if cell.total_mass <= 0.0 {
                continue;
            }
            if !Self::sphere_intersects_aabb(center, radius_sq, cell.center, cell.half_size) {
                continue;
            }

            if !cell.is_internal {
                let mut cur = cell.body_index;
                while let Some(b_idx) = cur {
                    let b = &self.bodies[b_idx as usize];
                    let dist_sq = (b.position - center).length_squared();
                    if dist_sq <= radius_sq {
                        hits.push((dist_sq, b.id));
                    }
                    cur = self.next_in_leaf[b_idx as usize];
                }
            } else {
                for &child_idx in &cell.children {
                    if child_idx != 0 && sp < stack.len() {
                        stack[sp] = child_idx;
                        sp += 1;
                    }
                }
            }
        }

        hits.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        hits.into_iter().take(max_results).map(|(_, id)| id).collect()
    }

    fn query_frustum(&self, frustum: &Frustum, out_ids: &mut Vec<u32>) {
        out_ids.clear();
        if self.cells.is_empty() {
            return;
        }

        let mut stack = [0u32; 96];
        let mut sp = 1usize;
        stack[0] = 0;

        while sp > 0 {
            sp -= 1;
            let cell = &self.cells[stack[sp] as usize];
            if cell.total_mass <= 0.0 {
                continue;
            }
            if !frustum.intersects_aabb(cell.center, cell.half_size) {
                continue;
            }

            if !cell.is_internal {
                let mut cur = cell.body_index;
                while let Some(b_idx) = cur {
                    let b = &self.bodies[b_idx as usize];
                    if frustum.contains_point(b.position) {
                        out_ids.push(b.id);
                    }
                    cur = self.next_in_leaf[b_idx as usize];
                }
            } else {
                for &child_idx in &cell.children {
                    if child_idx != 0 && sp < stack.len() {
                        stack[sp] = child_idx;
                        sp += 1;
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::DeterministicRng;

    #[test]
    fn two_bodies_repel_each_other_along_connecting_axis() {
        let bodies = vec![
            SpatialBody {
                id: 0,
                position: Vec3::new(-5.0, 0.0, 0.0),
                mass: 1.0,
            },
            SpatialBody {
                id: 1,
                position: Vec3::new(5.0, 0.0, 0.0),
                mass: 1.0,
            },
        ];

        let mut octree = OctreeSpatialIndex::default();
        octree.rebuild(&bodies);

        let force_on_0 = octree.compute_repulsion(0, bodies[0].position, 0.5, 100.0, 0.1);
        let force_on_1 = octree.compute_repulsion(1, bodies[1].position, 0.5, 100.0, 0.1);

        // Body 0 is at x = -5, so body 1 (at x = +5) pushes it in -X direction
        assert!(force_on_0.x < -0.5);
        assert!(force_on_0.y.abs() < 1e-5);
        assert!(force_on_0.z.abs() < 1e-5);

        // Newton's 3rd Law symmetry: equal and opposite
        assert!((force_on_0 + force_on_1).length() < 1e-4);
    }

    #[test]
    fn barnes_hut_approximation_closely_matches_exact_direct_sum() {
        let mut rng = DeterministicRng::new(99);
        let bodies: Vec<SpatialBody> = (0..120)
            .map(|id| SpatialBody {
                id,
                position: Vec3::new(
                    rng.next_range(-50.0, 50.0),
                    rng.next_range(-50.0, 50.0),
                    rng.next_range(-50.0, 50.0),
                ),
                mass: rng.next_range(0.8, 1.5),
            })
            .collect();

        let mut octree = OctreeSpatialIndex::default();
        octree.rebuild(&bodies);

        // theta = 0.0 forces exact evaluation
        let exact_force = octree.compute_repulsion(0, bodies[0].position, 0.0, 50.0, 1.0);
        // theta = 0.6 uses Barnes-Hut octree cell approximation
        let approx_force = octree.compute_repulsion(0, bodies[0].position, 0.6, 50.0, 1.0);

        let relative_error = (exact_force - approx_force).length() / exact_force.length().max(1e-5);
        assert!(
            relative_error < 0.10,
            "Expected relative error < 10%, got {:.4} (exact={:?}, approx={:?})",
            relative_error,
            exact_force,
            approx_force
        );
    }

    #[test]
    fn query_ray_picks_closest_intersected_body() {
        let bodies = vec![
            SpatialBody {
                id: 10,
                position: Vec3::new(0.0, 0.0, -20.0),
                mass: 1.0,
            },
            SpatialBody {
                id: 20,
                position: Vec3::new(0.2, 0.0, -10.0), // Closer to ray origin along -Z
                mass: 1.0,
            },
            SpatialBody {
                id: 30,
                position: Vec3::new(15.0, 15.0, -5.0), // Far off ray
                mass: 1.0,
            },
        ];

        let mut octree = OctreeSpatialIndex::default();
        octree.rebuild(&bodies);

        let ray = Ray::new(Vec3::new(0.0, 0.0, 0.0), Vec3::new(0.0, 0.0, -1.0));
        let hit = octree.query_ray(&ray, 1.0);
        assert_eq!(hit, Some(20));

        let miss_ray = Ray::new(Vec3::new(0.0, 0.0, 0.0), Vec3::new(0.0, 1.0, 0.0));
        assert_eq!(octree.query_ray(&miss_ray, 1.0), None);
    }

    #[test]
    fn query_sphere_returns_k_nearest_bodies_within_radius_sorted_by_distance() {
        let bodies = vec![
            SpatialBody {
                id: 1,
                position: Vec3::new(8.0, 0.0, 0.0), // dist = 8
                mass: 1.0,
            },
            SpatialBody {
                id: 2,
                position: Vec3::new(2.0, 0.0, 0.0), // dist = 2
                mass: 1.0,
            },
            SpatialBody {
                id: 3,
                position: Vec3::new(0.0, 5.0, 0.0), // dist = 5
                mass: 1.0,
            },
            SpatialBody {
                id: 4,
                position: Vec3::new(50.0, 0.0, 0.0), // dist = 50 (outside radius 10)
                mass: 1.0,
            },
        ];

        let mut octree = OctreeSpatialIndex::default();
        octree.rebuild(&bodies);

        // Query radius 10.0, max 10 results -> should return [2, 3, 1] sorted by distance
        let all_in_radius = octree.query_sphere(Vec3::ZERO, 10.0, 10);
        assert_eq!(all_in_radius, vec![2, 3, 1]);

        // K-NN with max_results = 2 -> should return closest 2: [2, 3]
        let knn_2 = octree.query_sphere(Vec3::ZERO, 10.0, 2);
        assert_eq!(knn_2, vec![2, 3]);
    }

    #[test]
    fn query_frustum_collects_only_bodies_inside_view_frustum() {
        let bodies = vec![
            SpatialBody {
                id: 100,
                position: Vec3::new(0.0, 0.0, 0.0), // At origin (in view)
                mass: 1.0,
            },
            SpatialBody {
                id: 200,
                position: Vec3::new(5.0, -3.0, 2.0), // Near origin (in view)
                mass: 1.0,
            },
            SpatialBody {
                id: 300,
                position: Vec3::new(500.0, 500.0, 500.0), // Far outside frustum
                mass: 1.0,
            },
        ];

        let mut octree = OctreeSpatialIndex::default();
        octree.rebuild(&bodies);

        let view = glam::Mat4::look_at_rh(Vec3::new(0.0, 0.0, 100.0), Vec3::ZERO, Vec3::Y);
        let proj = glam::Mat4::perspective_rh(45.0_f32.to_radians(), 1.0, 1.0, 300.0);
        let frustum = Frustum::from_view_proj(proj * view);

        let mut visible = Vec::new();
        octree.query_frustum(&frustum, &mut visible);
        visible.sort_unstable();

        assert_eq!(visible, vec![100, 200]);
    }

    #[test]
    fn coincident_bodies_are_pushed_apart_in_opposite_directions() {
        let bodies = [
            SpatialBody { id: 0, position: Vec3::ZERO, mass: 1.0 },
            SpatialBody { id: 1, position: Vec3::ZERO, mass: 1.0 },
        ];
        let mut tree = OctreeSpatialIndex::default();
        tree.rebuild(&bodies);
        let f0 = tree.compute_repulsion(0, Vec3::ZERO, 0.75, 25.0, 1.5);
        let f1 = tree.compute_repulsion(1, Vec3::ZERO, 0.75, 25.0, 1.5);
        assert!(f0.length() > 0.0, "stacked nodes must separate");
        assert!(f0.dot(f1) < 0.0, "forces must point away from each other");
    }

    #[test]
    fn barnes_hut_force_stays_close_to_exact_summation() {
        // Target sits inside a dense cluster with one far body: the approximation must stay
        // close to the exact O(N^2) sum.
        let mut rng = DeterministicRng::new(3);
        let mut bodies: Vec<SpatialBody> = (0..300)
            .map(|i| SpatialBody {
                id: i,
                position: Vec3::new(rng.next_range(-2.0, 2.0), rng.next_range(-2.0, 2.0), rng.next_range(-2.0, 2.0)),
                mass: 1.0,
            })
            .collect();
        bodies.push(SpatialBody { id: 300, position: Vec3::splat(80.0), mass: 1.0 });
        let mut tree = OctreeSpatialIndex::default();
        tree.rebuild(&bodies);
        let target = bodies[17];
        let exact = tree.compute_repulsion(target.id, target.position, 0.0, 25.0, 1.5);
        let approx = tree.compute_repulsion(target.id, target.position, 0.75, 25.0, 1.5);
        let err = (exact - approx).length() / exact.length().max(1e-6);
        assert!(err < 0.25, "relative error {err}");
    }

    #[test]
    fn large_nodes_are_pickable_across_their_drawn_radius() {
        let bodies = [SpatialBody { id: 7, position: Vec3::ZERO, mass: 10.0 }];
        let mut tree = OctreeSpatialIndex::default();
        tree.rebuild(&bodies);
        // Ray passes 8 units from the center: outside the 2.5 tolerance, inside the 9.5 radius
        let ray = Ray::new(Vec3::new(8.0, 0.0, 100.0), Vec3::new(0.0, 0.0, -1.0));
        assert_eq!(tree.query_ray(&ray, 2.5), Some(7));
    }

    #[test]
    fn octree_depth_is_clamped_to_the_traversal_stack() {
        let tree = OctreeSpatialIndex::new(40);
        assert!(tree.max_depth <= MAX_OCTREE_DEPTH);
    }

    #[test]
    fn compiled_traversal_preserves_forces_across_rebuilds_and_coincident_leaves() {
        // Reference traversal reads the spatial octree, never the compiled force records.
        fn reference(tree: &OctreeSpatialIndex, target: SpatialBody, theta: f32) -> Vec3 {
            let mut stack = vec![0usize];
            let mut force = Vec3::ZERO;
            while let Some(i) = stack.pop() {
                let c = &tree.cells[i];
                if c.total_mass <= 0.0 { continue; }
                if !c.is_internal {
                    let mut next = c.body_index;
                    while let Some(j) = next {
                        let b = &tree.bodies[j as usize];
                        if b.id != target.id {
                            force += pair_repulsion(target.id, target.position, b, 25.0, 1.5);
                        }
                        next = tree.next_in_leaf[j as usize];
                    }
                } else {
                    let delta = target.position - c.mass_weighted_sum / c.total_mass;
                    let d2 = delta.length_squared();
                    if (c.half_size * 2.0).powi(2) < theta * theta * d2 {
                        let softened = d2 + 1.5;
                        force += delta * (softened.sqrt().recip() * (25.0 * c.total_mass / softened));
                    } else {
                        stack.extend(c.children.iter().filter(|&&c| c != 0).map(|&c| c as usize));
                    }
                }
            }
            force
        }
        let mut rng = DeterministicRng::new(83);
        let mut tree = OctreeSpatialIndex::default();
        for count in [513, 23, 1024, 1] {
            let bodies: Vec<_> = (0..count).map(|id| SpatialBody {
                id,
                position: if id % 7 == 0 { Vec3::ZERO } else {
                    Vec3::new(rng.next_range(-80.0, 80.0), rng.next_range(-8.0, 8.0), rng.next_range(-8.0, 8.0))
                },
                mass: rng.next_range(0.1, 4.0),
            }).collect();
            tree.rebuild(&bodies);
            for body in bodies.iter().step_by(13) {
                for theta in [0.25, 0.75, 1.2] {
                    let actual = tree.compute_repulsion(body.id, body.position, theta, 25.0, 1.5);
                    assert_eq!(actual, reference(&tree, *body, theta));
                }
            }
        }
        tree.rebuild(&[]);
        assert_eq!(tree.compute_repulsion(0, Vec3::ZERO, 0.75, 25.0, 1.5), Vec3::ZERO);
    }
}
