//! Triangle BVH that accelerates ray picking on custom meshes.
//!
//! Built lazily (first raycast) over the mesh's local-space triangles and cached on the
//! `SceneObject`. Results are identical to the brute-force scan: the per-triangle test is the
//! same Möller–Trumbore code, and the node culling is padded so it can only skip triangles that
//! cannot produce a nearer accepted hit.
//!
//! Memory: 32 B per node + 4 B per triangle (reordered triangle ids). With leaves of at most
//! `LEAF_SIZE` triangles there are roughly `n / 2` nodes (`2 * n / LEAF_SIZE`), i.e. about
//! 20 B per triangle in total; vertex positions are read from the mesh, never copied.

use super::LocalVertex;
use glam::Vec3;
use std::sync::OnceLock;

/// Meshes below this triangle count are scanned linearly (no BVH is built).
pub(crate) const MIN_BVH_TRIANGLES: usize = 64;
const LEAF_SIZE: usize = 4;
const BINS: usize = 12;
/// Deeper ranges become leaves, so the fixed traversal stack never overflows.
const MAX_DEPTH: usize = 60;
const STACK_SIZE: usize = MAX_DEPTH + 4;

/// Möller–Trumbore ray/triangle test (two-sided). `dir` is unit length; returns `t >= 0`.
#[inline(always)]
fn intersect_triangle(origin: Vec3, dir: Vec3, v0: Vec3, v1: Vec3, v2: Vec3) -> Option<f32> {
    let e1 = v1 - v0;
    let e2 = v2 - v0;
    let h = dir.cross(e2);
    let a = e1.dot(h);
    if a.abs() < 1e-6 {
        return None;
    }
    let f = 1.0 / a;
    let s = origin - v0;
    let u = f * s.dot(h);
    if !(0.0..=1.0).contains(&u) {
        return None;
    }
    let q = s.cross(e1);
    let v = f * dir.dot(q);
    if v < 0.0 || u + v > 1.0 {
        return None;
    }
    let t = f * e2.dot(q);
    (t >= 0.0).then_some(t)
}

#[inline(always)]
fn tri_positions(vertices: &[LocalVertex], indices: &[u32], tri: usize) -> (Vec3, Vec3, Vec3) {
    let i = tri * 3;
    (
        vertices[indices[i] as usize].position,
        vertices[indices[i + 1] as usize].position,
        vertices[indices[i + 2] as usize].position,
    )
}

/// Brute-force nearest hit over every triangle.
pub(crate) fn intersect_triangles_linear(
    origin: Vec3,
    dir: Vec3,
    vertices: &[LocalVertex],
    indices: &[u32],
) -> Option<f32> {
    let mut best_t = f32::INFINITY;
    for tri in 0..indices.len() / 3 {
        let (v0, v1, v2) = tri_positions(vertices, indices, tri);
        if let Some(t) = intersect_triangle(origin, dir, v0, v1, v2) {
            if t < best_t {
                best_t = t;
            }
        }
    }
    best_t.is_finite().then_some(best_t)
}

#[derive(Debug, Clone, Copy)]
struct Node {
    min: Vec3,
    max: Vec3,
    /// Leaf: first entry in `tris`. Interior: index of the left child (right = left + 1).
    first: u32,
    /// Triangles in the leaf; 0 for interior nodes.
    count: u32,
}

/// Identity of the geometry a BVH was built from; a mismatch falls back to the linear scan.
/// Buffer address + length, plus a sample of first / last positions and indices so a
/// replacement buffer that reuses a freed address is still detected in practice.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct GeometryKey {
    vertices: (usize, usize),
    indices: (usize, usize),
    sample: [u32; 8],
}

impl GeometryKey {
    fn of(vertices: &[LocalVertex], indices: &[u32]) -> Self {
        let pos =
            |v: Option<&LocalVertex>| v.map_or([0; 3], |v| v.position.to_array().map(f32::to_bits));
        let (first, last) = (pos(vertices.first()), pos(vertices.last()));
        Self {
            vertices: (vertices.as_ptr() as usize, vertices.len()),
            indices: (indices.as_ptr() as usize, indices.len()),
            sample: [
                first[0],
                first[1],
                first[2],
                last[0],
                last[1],
                last[2],
                indices.first().copied().unwrap_or(0),
                indices.last().copied().unwrap_or(0),
            ],
        }
    }
}

#[derive(Debug)]
pub(crate) struct TriangleBvh {
    nodes: Vec<Node>,
    tris: Vec<u32>,
    /// Largest absolute local coordinate; scales the conservative culling tolerances.
    magnitude: f32,
    key: GeometryKey,
}

#[derive(Clone, Copy)]
struct Aabb {
    min: Vec3,
    max: Vec3,
}

impl Aabb {
    const EMPTY: Self = Self {
        min: Vec3::splat(f32::INFINITY),
        max: Vec3::splat(f32::NEG_INFINITY),
    };

    #[inline]
    fn grow(&mut self, other: &Aabb) {
        self.min = self.min.min(other.min);
        self.max = self.max.max(other.max);
    }

    #[inline]
    fn grow_point(&mut self, p: Vec3) {
        self.min = self.min.min(p);
        self.max = self.max.max(p);
    }

    #[inline]
    fn half_area(&self) -> f32 {
        let d = (self.max - self.min).max(Vec3::ZERO);
        d.x * d.y + d.y * d.z + d.z * d.x
    }
}

impl TriangleBvh {
    /// Builds a binned-SAH BVH. `indices` must hold whole, in-range triangles.
    pub(crate) fn build(vertices: &[LocalVertex], indices: &[u32]) -> Self {
        let n = indices.len() / 3;
        let mut bounds = Vec::with_capacity(n);
        let mut centroids = Vec::with_capacity(n);
        let mut magnitude = 0.0f32;
        for tri in 0..n {
            let (v0, v1, v2) = tri_positions(vertices, indices, tri);
            let b = Aabb {
                min: v0.min(v1).min(v2),
                max: v0.max(v1).max(v2),
            };
            magnitude = magnitude
                .max(b.min.abs().max_element())
                .max(b.max.abs().max_element());
            centroids.push((b.min + b.max) * 0.5);
            bounds.push(b);
        }
        // Spatial slack covering the rounding of the barycentric tests near triangle edges.
        let pad = Vec3::splat(magnitude * 1e-4 + 1e-7);

        let mut tris: Vec<u32> = (0..n as u32).collect();
        let mut nodes = Vec::with_capacity((2 * n / LEAF_SIZE).max(1));
        nodes.push(Node {
            min: Vec3::ZERO,
            max: Vec3::ZERO,
            first: 0,
            count: 0,
        });
        // (node, start, end, depth)
        let mut work = vec![(0usize, 0usize, n, 0usize)];
        while let Some((node, start, end, depth)) = work.pop() {
            let mut bb = Aabb::EMPTY;
            let mut cb = Aabb::EMPTY;
            for &t in &tris[start..end] {
                bb.grow(&bounds[t as usize]);
                cb.grow_point(centroids[t as usize]);
            }
            nodes[node].min = bb.min - pad;
            nodes[node].max = bb.max + pad;
            let count = end - start;
            let make_leaf = |nodes: &mut Vec<Node>| {
                nodes[node].first = start as u32;
                nodes[node].count = count as u32;
            };
            if count <= LEAF_SIZE || depth >= MAX_DEPTH {
                make_leaf(&mut nodes);
                continue;
            }
            let mid = match sah_split(&tris[start..end], &bounds, &centroids, &cb) {
                Some((axis, split)) => {
                    let (lo, hi) = (cb.min[axis], cb.max[axis]);
                    let scale = BINS as f32 / (hi - lo);
                    let slice = &mut tris[start..end];
                    let mut i = 0;
                    for j in 0..slice.len() {
                        if bin_of(centroids[slice[j] as usize][axis], lo, scale) < split {
                            slice.swap(i, j);
                            i += 1;
                        }
                    }
                    i
                }
                None => 0,
            };
            let mid = if mid == 0 || mid == count {
                if count <= 4 * LEAF_SIZE {
                    make_leaf(&mut nodes);
                    continue;
                }
                // Degenerate split (coincident centroids): object median on the widest axis.
                let ext = cb.max - cb.min;
                let axis = if ext.x >= ext.y && ext.x >= ext.z {
                    0
                } else if ext.y >= ext.z {
                    1
                } else {
                    2
                };
                let half = count / 2;
                tris[start..end].select_nth_unstable_by(half, |a, b| {
                    centroids[*a as usize][axis].total_cmp(&centroids[*b as usize][axis])
                });
                half
            } else {
                mid
            };
            let left = nodes.len();
            nodes.push(Node {
                min: Vec3::ZERO,
                max: Vec3::ZERO,
                first: 0,
                count: 0,
            });
            nodes.push(Node {
                min: Vec3::ZERO,
                max: Vec3::ZERO,
                first: 0,
                count: 0,
            });
            nodes[node].first = left as u32;
            nodes[node].count = 0;
            work.push((left + 1, start + mid, end, depth + 1));
            work.push((left, start, start + mid, depth + 1));
        }
        nodes.shrink_to_fit();
        Self {
            nodes,
            tris,
            magnitude,
            key: GeometryKey::of(vertices, indices),
        }
    }

    /// Heap bytes held by this BVH.
    #[cfg(test)]
    pub(crate) fn heap_bytes(&self) -> usize {
        self.nodes.capacity() * std::mem::size_of::<Node>()
            + self.tris.capacity() * std::mem::size_of::<u32>()
    }

    /// Nearest hit; identical to `intersect_triangles_linear` on the same geometry.
    pub(crate) fn intersect(
        &self,
        origin: Vec3,
        dir: Vec3,
        vertices: &[LocalVertex],
        indices: &[u32],
    ) -> Option<f32> {
        // Zero direction components get a huge finite reciprocal: no NaN from 0 * inf when the
        // origin lies exactly on a slab plane.
        let inv = |d: f32| if d.abs() < 1e-30 { 1e30 } else { 1.0 / d };
        let inv_dir = Vec3::new(inv(dir.x), inv(dir.y), inv(dir.z));
        // Slack in `t` covering the rounding of the triangle test relative to the node slabs.
        let tol = (origin.abs().max_element() + self.magnitude) * 1e-4 + 1e-6;
        let slab = |n: &Node| -> f32 {
            let t1 = (n.min - origin) * inv_dir;
            let t2 = (n.max - origin) * inv_dir;
            let tmin = t1.min(t2).max_element();
            let tmax = t1.max(t2).min_element();
            if tmin <= tmax + tol && tmax >= -tol {
                tmin
            } else {
                f32::INFINITY
            }
        };

        let mut best_t = f32::INFINITY;
        let mut stack = [(0u32, 0.0f32); STACK_SIZE];
        let root_t = slab(&self.nodes[0]);
        if root_t == f32::INFINITY {
            return None;
        }
        stack[0] = (0, root_t);
        let mut sp = 1;
        while sp > 0 {
            sp -= 1;
            let (ni, entry) = stack[sp];
            if entry > best_t + tol {
                continue;
            }
            let node = &self.nodes[ni as usize];
            if node.count > 0 {
                let first = node.first as usize;
                for &tri in &self.tris[first..first + node.count as usize] {
                    let (v0, v1, v2) = tri_positions(vertices, indices, tri as usize);
                    if let Some(t) = intersect_triangle(origin, dir, v0, v1, v2) {
                        if t < best_t {
                            best_t = t;
                        }
                    }
                }
                continue;
            }
            let l = node.first;
            let (tl, tr) = (
                slab(&self.nodes[l as usize]),
                slab(&self.nodes[l as usize + 1]),
            );
            // Push the far child first so the near one is popped next.
            let (near, far) = if tl <= tr {
                ((l, tl), (l + 1, tr))
            } else {
                ((l + 1, tr), (l, tl))
            };
            for (c, t) in [far, near] {
                if t != f32::INFINITY && t <= best_t + tol {
                    stack[sp] = (c, t);
                    sp += 1;
                }
            }
        }
        best_t.is_finite().then_some(best_t)
    }
}

#[inline]
fn bin_of(c: f32, lo: f32, scale: f32) -> usize {
    (((c - lo) * scale) as usize).min(BINS - 1)
}

/// Best binned-SAH split `(axis, first bin of the right side)`, or `None` when splitting does
/// not beat a leaf or no axis has centroid extent.
fn sah_split(
    tris: &[u32],
    bounds: &[Aabb],
    centroids: &[Vec3],
    cb: &Aabb,
) -> Option<(usize, usize)> {
    let mut best: Option<(usize, usize)> = None;
    let mut best_cost = f32::INFINITY;
    for axis in [0usize, 1, 2] {
        let (lo, hi) = (cb.min[axis], cb.max[axis]);
        let extent = hi - lo;
        if extent.is_nan() || extent <= 0.0 || !(BINS as f32 / extent).is_finite() {
            continue;
        }
        let scale = BINS as f32 / (hi - lo);
        let mut bin_bounds = [Aabb::EMPTY; BINS];
        let mut bin_count = [0usize; BINS];
        for &t in tris {
            let b = bin_of(centroids[t as usize][axis], lo, scale);
            bin_count[b] += 1;
            bin_bounds[b].grow(&bounds[t as usize]);
        }
        // Sweep from the right: area and count of bins [i, BINS)
        let mut right_area = [0.0f32; BINS];
        let mut right_count = [0usize; BINS];
        let mut acc = Aabb::EMPTY;
        let mut cnt = 0;
        for i in (1..BINS).rev() {
            acc.grow(&bin_bounds[i]);
            cnt += bin_count[i];
            right_area[i] = acc.half_area();
            right_count[i] = cnt;
        }
        let mut acc = Aabb::EMPTY;
        let mut cnt = 0;
        for split in 1..BINS {
            acc.grow(&bin_bounds[split - 1]);
            cnt += bin_count[split - 1];
            if cnt == 0 || right_count[split] == 0 {
                continue;
            }
            let cost = acc.half_area() * cnt as f32 + right_area[split] * right_count[split] as f32;
            if cost < best_cost {
                best_cost = cost;
                best = Some((axis, split));
            }
        }
    }
    best
}

/// Lazily built BVH attached to a custom-mesh `SceneObject`. Cloning yields an empty cache
/// (the clone rebuilds on demand), so copies never share or duplicate BVH memory.
#[derive(Default)]
pub struct PickCache(OnceLock<TriangleBvh>);

impl Clone for PickCache {
    fn clone(&self) -> Self {
        Self::default()
    }
}

impl std::fmt::Debug for PickCache {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PickCache")
            .field("built", &self.0.get().is_some())
            .finish()
    }
}

impl PickCache {
    /// Drops the cached BVH; call after mutating custom-mesh positions or indices in place.
    pub fn invalidate(&mut self) {
        self.0.take();
    }

    #[cfg(test)]
    pub(crate) fn bvh(&self) -> Option<&TriangleBvh> {
        self.0.get()
    }

    /// Nearest local-space hit on the mesh, via the BVH for meshes of at least
    /// `MIN_BVH_TRIANGLES` triangles (built on first use) and a linear scan otherwise.
    pub(crate) fn intersect(
        &self,
        origin: Vec3,
        dir: Vec3,
        vertices: &[LocalVertex],
        indices: &[u32],
    ) -> Option<f32> {
        if indices.len() / 3 < MIN_BVH_TRIANGLES || !origin.is_finite() || !dir.is_finite() {
            return intersect_triangles_linear(origin, dir, vertices, indices);
        }
        let bvh = self.0.get_or_init(|| TriangleBvh::build(vertices, indices));
        if bvh.key != GeometryKey::of(vertices, indices) {
            // Geometry was replaced behind the cache's back: stay correct, skip the BVH.
            return intersect_triangles_linear(origin, dir, vertices, indices);
        }
        bvh.intersect(origin, dir, vertices, indices)
    }
}
