//! Picking: triangle BVH vs brute force, scene-level AABB culling, analytic cylinder.

use super::bvh::{intersect_triangles_linear, TriangleBvh, MIN_BVH_TRIANGLES};
use super::pick::intersect_local_cylinder;
use super::*;
use crate::domain::DeterministicRng;

fn bits(t: Option<f32>) -> Option<u32> {
    t.map(f32::to_bits)
}

fn rand_vec(rng: &mut DeterministicRng, lo: f32, hi: f32) -> Vec3 {
    Vec3::new(
        rng.next_range(lo, hi),
        rng.next_range(lo, hi),
        rng.next_range(lo, hi),
    )
}

fn rand_dir(rng: &mut DeterministicRng) -> Vec3 {
    loop {
        let d = rand_vec(rng, -1.0, 1.0);
        if d.length_squared() > 1e-4 {
            return d.normalize();
        }
    }
}

fn to_vertices(positions: &[Vec3]) -> Vec<LocalVertex> {
    positions
        .iter()
        .map(|&position| LocalVertex {
            position,
            normal: Vec3::Y,
            uv: [0.0; 2],
        })
        .collect()
}

fn flatten(positions: &[Vec3]) -> Vec<f32> {
    positions.iter().flat_map(|p| p.to_array()).collect()
}

/// Random triangle soup with degenerate members (repeated index, collinear, zero-area sliver).
fn soup(rng: &mut DeterministicRng, tris: usize) -> (Vec<Vec3>, Vec<u32>) {
    let mut p = Vec::new();
    let mut idx = Vec::new();
    for i in 0..tris {
        let base = p.len() as u32;
        let c = rand_vec(rng, -2.0, 2.0);
        let size = rng.next_range(0.05, 0.8);
        let a = c + rand_vec(rng, -size, size);
        let b = c + rand_vec(rng, -size, size);
        match i % 17 {
            0 => p.extend([a, b, (a + b) * 0.5]), // collinear
            1 => p.extend([a, a, b]),             // repeated vertex
            _ => p.extend([a, b, c + rand_vec(rng, -size, size)]),
        }
        if i % 23 == 0 {
            idx.extend([base, base, base + 1]); // repeated index
        } else {
            idx.extend([base, base + 1, base + 2]);
        }
    }
    (p, idx)
}

/// Indexed grid on `y = 0` (axis-aligned faces) with a bumpy half, `n x n` quads.
fn grid(n: u32, bump: bool) -> (Vec<Vec3>, Vec<u32>) {
    let mut p = Vec::new();
    for j in 0..=n {
        for i in 0..=n {
            let (x, z) = (
                i as f32 / n as f32 * 2.0 - 1.0,
                j as f32 / n as f32 * 2.0 - 1.0,
            );
            let y = if bump && x > 0.0 {
                (x * 7.0).sin() * (z * 5.0).cos() * 0.3
            } else {
                0.0
            };
            p.push(Vec3::new(x, y, z));
        }
    }
    let mut idx = Vec::new();
    let w = n + 1;
    for j in 0..n {
        for i in 0..n {
            let a = j * w + i;
            idx.extend([a, a + 1, a + w, a + 1, a + w + 1, a + w]);
        }
    }
    (p, idx)
}

/// Closed UV sphere of radius 1 (origins inside hit the far wall).
fn sphere(seg: u32, rings: u32) -> (Vec<Vec3>, Vec<u32>) {
    let mut p = Vec::new();
    for r in 0..=rings {
        let phi = r as f32 / rings as f32 * PI;
        for s in 0..=seg {
            let th = s as f32 / seg as f32 * TAU;
            p.push(Vec3::new(
                phi.sin() * th.cos(),
                phi.cos(),
                phi.sin() * th.sin(),
            ));
        }
    }
    let mut idx = Vec::new();
    let w = seg + 1;
    for r in 0..rings {
        for s in 0..seg {
            let a = r * w + s;
            idx.extend([a, a + w, a + 1, a + 1, a + w, a + w + 1]);
        }
    }
    (p, idx)
}

/// Rays of every kind against `p`: random, aimed at triangle edges/vertices, axis-aligned
/// (parallel to the grid faces), with zero direction components, and from inside.
fn rays(rng: &mut DeterministicRng, p: &[Vec3], idx: &[u32], count: usize) -> Vec<(Vec3, Vec3)> {
    let mut out = Vec::with_capacity(count);
    let tris = idx.len() / 3;
    for i in 0..count {
        let origin = rand_vec(rng, -3.0, 3.0);
        let dir = match i % 6 {
            0 | 1 => rand_dir(rng),
            2 => {
                // At a point on a random triangle's boundary or inside it
                let t = (rng.next_u32() as usize) % tris;
                let (a, b, c) = (
                    p[idx[t * 3] as usize],
                    p[idx[t * 3 + 1] as usize],
                    p[idx[t * 3 + 2] as usize],
                );
                let (u, v) = match rng.next_u32() % 4 {
                    0 => (0.0, rng.next_f32()),
                    1 => (rng.next_f32(), 0.0),
                    2 => {
                        let u = rng.next_f32();
                        (u, 1.0 - u)
                    }
                    _ => (0.0, 0.0),
                };
                let target = a + (b - a) * u + (c - a) * v;
                let d = target - origin;
                if d.length_squared() < 1e-8 {
                    rand_dir(rng)
                } else {
                    d.normalize()
                }
            }
            3 => [
                Vec3::X,
                Vec3::NEG_X,
                Vec3::Y,
                Vec3::NEG_Y,
                Vec3::Z,
                Vec3::NEG_Z,
            ][(rng.next_u32() % 6) as usize],
            4 => {
                // In the y = 0 plane (parallel to the flat grid faces) or grazing it
                let a = rng.next_range(0.0, TAU);
                let y = if rng.next_f32() < 0.5 {
                    0.0
                } else {
                    rng.next_range(-2e-3, 2e-3)
                };
                Vec3::new(a.cos(), y, a.sin()).normalize()
            }
            _ => rand_dir(rng),
        };
        let origin = if i % 6 == 4 && rng.next_f32() < 0.5 {
            Vec3::new(origin.x, 0.0, origin.z)
        } else {
            origin
        };
        let origin = if i % 6 == 5 {
            rand_vec(rng, -0.5, 0.5)
        } else {
            origin
        };
        out.push((origin, dir));
    }
    out
}

fn assert_bvh_matches_linear(
    p: &[Vec3],
    idx: &[u32],
    rng: &mut DeterministicRng,
    ray_count: usize,
) {
    let vertices = to_vertices(p);
    let bvh = TriangleBvh::build(&vertices, idx);
    let mut hits = 0;
    for (k, (o, d)) in rays(rng, p, idx, ray_count).into_iter().enumerate() {
        let want = intersect_triangles_linear(o, d, &vertices, idx);
        let got = bvh.intersect(o, d, &vertices, idx);
        assert_eq!(
            bits(got),
            bits(want),
            "ray {k}: origin {o:?} dir {d:?}: bvh {got:?} vs linear {want:?}"
        );
        hits += want.is_some() as usize;
    }
    assert!(
        hits > ray_count / 20,
        "too few hits ({hits}) to be meaningful"
    );
}

#[test]
fn bvh_matches_brute_force_on_random_meshes() {
    let mut rng = DeterministicRng::new(0xB0B);
    for tris in [64, 200, 1500] {
        let (p, idx) = soup(&mut rng, tris);
        assert_bvh_matches_linear(&p, &idx, &mut rng, 4000);
    }
    let (p, idx) = grid(24, true);
    assert_bvh_matches_linear(&p, &idx, &mut rng, 6000);
    let (p, idx) = sphere(32, 20);
    assert_bvh_matches_linear(&p, &idx, &mut rng, 4000);
    // All triangles coincident: degenerate (median) splits
    let (p, _) = soup(&mut rng, 1);
    let p = [p[0], p[1], p[2]];
    let idx: Vec<u32> = (0..300).flat_map(|_| [0, 1, 2]).collect();
    let vertices = to_vertices(&p);
    let bvh = TriangleBvh::build(&vertices, &idx);
    for (o, d) in rays(&mut rng, &p, &idx, 500) {
        assert_eq!(
            bits(bvh.intersect(o, d, &vertices, &idx)),
            bits(intersect_triangles_linear(o, d, &vertices, &idx))
        );
    }
}

/// Reference: the pre-BVH, pre-culling scene raycast (linear triangles, every object).
fn reference_raycast(scene: &SceneWorld, ray: &Ray) -> Option<(u32, Vec3)> {
    let mut best = None;
    let mut best_t = f32::INFINITY;
    for obj in scene.objects() {
        if !obj.visible {
            continue;
        }
        let world = scene.world_matrix_of(obj.id);
        let t = match &obj.geometry {
            SceneGeometry::Custom {
                vertices,
                indices,
                local_half_extents,
            } => {
                let inv = world.inverse();
                let o = inv.transform_point3(ray.origin);
                let du = inv.transform_vector3(ray.direction);
                let len = du.length();
                if len < 1e-6 {
                    continue;
                }
                let d = du / len;
                intersect_local_aabb(o, d, (*local_half_extents).max(Vec3::splat(0.1)))
                    .and_then(|_| intersect_triangles_linear(o, d, vertices, indices))
                    .map(|t| t / len)
            }
            _ => obj.intersect_ray(&world, ray),
        };
        if let Some(t) = t {
            if t < best_t {
                best_t = t;
                best = Some(obj.id);
            }
        }
    }
    best.map(|id| (id, ray.origin + ray.direction * best_t))
}

#[test]
fn scene_raycast_matches_unculled_linear_reference() {
    let mut rng = DeterministicRng::new(77);
    let mut scene = SceneWorld::new();
    let kinds = [
        PrimitiveKind::Box,
        PrimitiveKind::Sphere,
        PrimitiveKind::Plane,
        PrimitiveKind::Cylinder,
    ];
    let mut ids = Vec::new();
    for i in 0..60 {
        let pos = rand_vec(&mut rng, -30.0, 30.0);
        let scale = rand_vec(&mut rng, 0.5, 8.0);
        let id = if i % 4 == 0 {
            let (p, idx) = if i % 8 == 0 {
                sphere(16, 10)
            } else {
                soup(&mut rng, 120)
            };
            scene
                .add_custom_mesh(
                    &flatten(&p),
                    &[],
                    &idx,
                    pos,
                    scale,
                    [1.0; 4],
                    BodyType::Static,
                )
                .unwrap()
        } else {
            scene.add_primitive(kinds[i % 4], pos, scale, [1.0; 4], BodyType::Static)
        };
        scene.find_object_mut(id).unwrap().transform.euler_radians = rand_vec(&mut rng, -PI, PI);
        if i % 5 == 0 && !ids.is_empty() {
            let parent = ids[(rng.next_u32() as usize) % ids.len()];
            scene.set_object_parent(id, Some(parent));
        }
        if i % 13 == 0 {
            scene.find_object_mut(id).unwrap().visible = false;
        }
        ids.push(id);
    }
    let mut hits = 0;
    for k in 0..4000 {
        let origin = rand_vec(&mut rng, -80.0, 80.0);
        // Half the rays aim at an object so most of them hit something
        let dir = if k % 2 == 0 {
            let target = scene
                .world_matrix_of(ids[(rng.next_u32() as usize) % ids.len()])
                .transform_point3(rand_vec(&mut rng, -0.5, 0.5));
            target - origin
        } else {
            rand_dir(&mut rng)
        };
        let ray = Ray::new(origin, dir);
        let want = reference_raycast(&scene, &ray);
        let got = scene.raycast_object_silent(&ray);
        assert_eq!(
            got.map(|(id, p)| (id, p.to_array().map(f32::to_bits))),
            want.map(|(id, p)| (id, p.to_array().map(f32::to_bits))),
            "ray {k}: {ray:?}"
        );
        hits += want.is_some() as usize;
    }
    assert!(hits > 1000, "only {hits} hits");
    // Unnormalized directions: t is in units of `ray.direction`
    for _ in 0..500 {
        let ray = Ray {
            origin: rand_vec(&mut rng, -60.0, 60.0),
            direction: rand_vec(&mut rng, -3.0, 3.0),
        };
        assert_eq!(
            scene.raycast_object_silent(&ray),
            reference_raycast(&scene, &ray)
        );
    }
}

fn custom_object(scene: &SceneWorld, id: u32) -> &SceneObject {
    scene.find_object(id).unwrap()
}

#[test]
fn bvh_is_built_lazily_and_tiny_meshes_stay_linear() {
    let mut scene = SceneWorld::new();
    let (p, idx) = grid(4, false); // 32 triangles
    assert!(idx.len() / 3 < MIN_BVH_TRIANGLES);
    let tiny = scene
        .add_custom_mesh(
            &flatten(&p),
            &[],
            &idx,
            Vec3::ZERO,
            Vec3::ONE,
            [1.0; 4],
            BodyType::Static,
        )
        .unwrap();
    let (p, idx) = grid(16, true);
    let big = scene
        .add_custom_mesh(
            &flatten(&p),
            &[],
            &idx,
            Vec3::new(10.0, 0.0, 0.0),
            Vec3::ONE,
            [1.0; 4],
            BodyType::Static,
        )
        .unwrap();
    assert!(
        custom_object(&scene, big).pick_cache.bvh().is_none(),
        "not built before the first raycast"
    );

    let down = Vec3::NEG_Y;
    let (id, hit) = scene
        .raycast_object_silent(&Ray::new(Vec3::new(0.3, 5.0, 0.2), down))
        .unwrap();
    assert_eq!(id, tiny);
    assert!(hit.y.abs() < 1e-5);
    assert!(
        custom_object(&scene, tiny).pick_cache.bvh().is_none(),
        "tiny mesh uses the linear scan"
    );

    let (id, _) = scene
        .raycast_object_silent(&Ray::new(Vec3::new(9.5, 5.0, 0.2), down))
        .unwrap();
    assert_eq!(id, big);
    let bvh = custom_object(&scene, big)
        .pick_cache
        .bvh()
        .expect("built on first raycast");
    let per_tri = bvh.heap_bytes() as f32 / (idx.len() / 3) as f32;
    assert!(per_tri < 40.0, "{per_tri} B/triangle");

    // A clone does not copy the BVH; it rebuilds on demand with identical results
    let clone = custom_object(&scene, big).clone();
    assert!(clone.pick_cache.bvh().is_none());
    let world = scene.world_matrix_of(big);
    let ray = Ray::new(Vec3::new(10.6, 3.0, -0.4), Vec3::new(-0.1, -1.0, 0.05));
    assert_eq!(
        clone.intersect_ray(&world, &ray),
        custom_object(&scene, big).intersect_ray(&world, &ray)
    );
    assert!(clone.pick_cache.bvh().is_some());
}

#[test]
fn bvh_follows_geometry_changes() {
    let mut scene = SceneWorld::new();
    let (p, idx) = grid(16, false); // flat at y = 0
    let id = scene
        .add_custom_mesh(
            &flatten(&p),
            &[],
            &idx,
            Vec3::ZERO,
            Vec3::ONE,
            [1.0; 4],
            BodyType::Static,
        )
        .unwrap();
    let ray = Ray::new(Vec3::new(0.21, 5.0, 0.13), Vec3::NEG_Y);
    let (_, hit) = scene.raycast_object_silent(&ray).unwrap();
    assert!(hit.y.abs() < 1e-5);

    // UV edits keep positions: BVH kept, same hit
    assert!(scene
        .set_custom_mesh_uvs(id, &vec![0.5; p.len() * 2])
        .unwrap());
    assert!(custom_object(&scene, id).pick_cache.bvh().is_some());
    assert_eq!(scene.raycast_object_silent(&ray).unwrap().1, hit);

    // Geometry replaced behind the cache: the stale BVH is not used
    let lifted: Vec<Vec3> = p.iter().map(|v| *v + Vec3::Y * 0.5).collect();
    let obj = scene.find_object_mut(id).unwrap();
    obj.geometry = SceneGeometry::Custom {
        vertices: to_vertices(&lifted),
        indices: idx.clone(),
        local_half_extents: Vec3::new(1.0, 0.5, 1.0),
    };
    let (_, hit) = scene.raycast_object_silent(&ray).unwrap();
    assert!((hit.y - 0.5).abs() < 1e-5, "{hit:?}");

    // In-place position edits need an explicit invalidate; then a fresh BVH is built
    let obj = scene.find_object_mut(id).unwrap();
    if let SceneGeometry::Custom {
        vertices,
        local_half_extents,
        ..
    } = &mut obj.geometry
    {
        for v in vertices.iter_mut() {
            v.position.y = -0.25;
        }
        *local_half_extents = Vec3::new(1.0, 0.25, 1.0);
    }
    obj.pick_cache.invalidate();
    let (_, hit) = scene.raycast_object_silent(&ray).unwrap();
    assert!((hit.y + 0.25).abs() < 1e-5, "{hit:?}");
    assert!(custom_object(&scene, id).pick_cache.bvh().is_some());
}

#[test]
fn cylinder_is_picked_analytically() {
    let near = |a: Option<f32>, b: f32| a.is_some_and(|a| (a - b).abs() < 1e-5);
    // Side from outside along x
    assert!(near(
        intersect_local_cylinder(Vec3::new(-3.0, 0.2, 0.0), Vec3::X),
        2.5
    ));
    // Side off-centre: chord at z = 0.3 -> x = -0.4
    assert!(near(
        intersect_local_cylinder(Vec3::new(-3.0, 0.0, 0.3), Vec3::X),
        2.6
    ));
    // Caps from above / below
    assert!(near(
        intersect_local_cylinder(Vec3::new(0.1, 4.0, -0.2), Vec3::NEG_Y),
        3.5
    ));
    assert!(near(
        intersect_local_cylinder(Vec3::new(0.0, -2.0, 0.0), Vec3::Y),
        1.5
    ));
    // Oblique through the top rim region onto the cap
    let d = Vec3::new(0.0, -1.0, 1.0).normalize();
    assert!(near(
        intersect_local_cylinder(Vec3::new(0.0, 1.0, -0.6), d),
        0.5 * 2f32.sqrt()
    ));
    // Above a cap corner: inside the bounding box, outside the disc -> miss (the AABB hit it)
    let (o, d) = (Vec3::new(0.45, 3.0, 0.45), Vec3::NEG_Y);
    assert!(intersect_local_aabb(o, d, Vec3::splat(0.5)).is_some());
    assert!(intersect_local_cylinder(o, d).is_none());
    // Crosses the box's vertical edge region 0.636 from the axis -> miss (the AABB hit it)
    let (o, d) = (
        Vec3::new(-2.55, 0.0, 3.45),
        Vec3::new(1.0, 0.0, -1.0).normalize(),
    );
    assert!(intersect_local_aabb(o, d, Vec3::splat(0.5)).is_some());
    assert!(intersect_local_cylinder(o, d).is_none());
    // Parallel to the axis outside the disc; above the top moving away
    assert!(intersect_local_cylinder(Vec3::new(0.6, -3.0, 0.0), Vec3::Y).is_none());
    assert!(intersect_local_cylinder(Vec3::new(0.0, 2.0, 0.0), Vec3::Y).is_none());
    // From inside: exit point (same convention as the box)
    assert!(near(intersect_local_cylinder(Vec3::ZERO, Vec3::X), 0.5));
    assert!(near(intersect_local_cylinder(Vec3::ZERO, Vec3::Y), 0.5));

    // Through the scene: a scaled cylinder misses at the bounding-box corner
    let mut scene = SceneWorld::new();
    let id = scene.add_primitive(
        PrimitiveKind::Cylinder,
        Vec3::ZERO,
        Vec3::new(2.0, 4.0, 2.0),
        [1.0; 4],
        BodyType::Static,
    );
    let (hit_id, hit) = scene
        .raycast_object_silent(&Ray::new(Vec3::new(-5.0, 1.0, 0.0), Vec3::X))
        .unwrap();
    assert_eq!(hit_id, id);
    assert!((hit.x + 1.0).abs() < 1e-5);
    assert!(scene
        .raycast_object_silent(&Ray::new(Vec3::new(0.9, 10.0, 0.9), Vec3::NEG_Y))
        .is_none());
    let (_, hit) = scene
        .raycast_object_silent(&Ray::new(Vec3::new(0.5, 10.0, 0.5), Vec3::NEG_Y))
        .unwrap();
    assert!((hit.y - 2.0).abs() < 1e-5);
}

/// `cargo test -p charturbo-core --release -- --ignored --nocapture bvh_pick_benchmark`
#[test]
#[ignore]
fn bvh_pick_benchmark() {
    use std::time::Instant;
    let (p, idx) = sphere(400, 250); // 200k triangles
    let vertices = to_vertices(&p);
    let n_tris = idx.len() / 3;
    let mut rng = DeterministicRng::new(5);
    let rays: Vec<(Vec3, Vec3)> = (0..10_000)
        .map(|_| {
            let o = rand_dir(&mut rng) * 3.0;
            (o, (rand_vec(&mut rng, -0.8, 0.8) - o).normalize())
        })
        .collect();

    let t0 = Instant::now();
    let bvh = TriangleBvh::build(&vertices, &idx);
    let build = t0.elapsed();
    let t0 = Instant::now();
    let fast: Vec<Option<f32>> = rays
        .iter()
        .map(|&(o, d)| bvh.intersect(o, d, &vertices, &idx))
        .collect();
    let bvh_time = t0.elapsed();
    let linear_rays = 1000;
    let t0 = Instant::now();
    let slow: Vec<Option<f32>> = rays[..linear_rays]
        .iter()
        .map(|&(o, d)| intersect_triangles_linear(o, d, &vertices, &idx))
        .collect();
    let linear_time = t0.elapsed();
    assert_eq!(
        fast[..linear_rays]
            .iter()
            .map(|t| bits(*t))
            .collect::<Vec<_>>(),
        slow.iter().map(|t| bits(*t)).collect::<Vec<_>>()
    );
    let per_ray_lin = linear_time.as_secs_f64() / linear_rays as f64;
    let per_ray_bvh = bvh_time.as_secs_f64() / rays.len() as f64;
    println!(
        "{n_tris} tris: build {:.1} ms, {:.0} B/tri; linear {:.1} us/ray (10k rays ~ {:.0} ms); bvh {:.2} us/ray (10k rays {:.1} ms); speedup {:.0}x; hits {}",
        build.as_secs_f64() * 1e3,
        bvh.heap_bytes() as f64 / n_tris as f64,
        per_ray_lin * 1e6,
        per_ray_lin * 1e4 * 1e3,
        per_ray_bvh * 1e6,
        bvh_time.as_secs_f64() * 1e3,
        per_ray_lin / per_ray_bvh,
        fast.iter().filter(|t| t.is_some()).count()
    );
}
