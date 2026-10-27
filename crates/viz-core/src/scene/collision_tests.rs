//! Oriented rigid-body collisions, the sweep broad phase, plane picking and highlight styling.

use super::collision::{self, Collider, Shape};
use super::*;
use crate::domain::DeterministicRng;

const DT: f32 = 1.0 / 60.0;

fn floor_scene() -> SceneWorld {
    let mut scene = SceneWorld::new();
    // The example floor: a plane scaled [x, 2, z] at y = -1 -> surface at y = -1
    scene.add_primitive(PrimitiveKind::Plane, Vec3::new(0.0, -1.0, 0.0), Vec3::new(60.0, 2.0, 60.0), [0.3; 4], BodyType::Static);
    scene
}

fn add_dynamic(scene: &mut SceneWorld, kind: PrimitiveKind, pos: Vec3, scale: Vec3, euler: Vec3) -> u32 {
    let id = scene.add_primitive(kind, pos, scale, [0.8; 4], BodyType::Dynamic);
    scene.find_object_mut(id).unwrap().transform.euler_radians = euler;
    id
}

fn run(scene: &mut SceneWorld, steps: usize) {
    for _ in 0..steps {
        scene.step_physics(DT);
    }
}

/// Lowest / highest world y of the object's oriented box corners.
fn y_range(scene: &SceneWorld, id: u32) -> (f32, f32) {
    let obj = scene.find_object(id).unwrap();
    let m = scene.world_matrix_of(id);
    let he = obj.base_half_extents();
    let mut lo = f32::INFINITY;
    let mut hi = f32::NEG_INFINITY;
    for k in 0..8 {
        let c = Vec3::new(
            if k & 1 == 0 { -he.x } else { he.x },
            if k & 2 == 0 { -he.y } else { he.y },
            if k & 4 == 0 { -he.z } else { he.z },
        );
        let y = m.transform_point3(c).y;
        lo = lo.min(y);
        hi = hi.max(y);
    }
    (lo, hi)
}

const EPS: f32 = 0.02;

#[test]
fn rotated_box_rests_on_the_floor_without_gap_or_sinking() {
    for euler in [Vec3::new(0.0, 0.0, 0.6), Vec3::new(0.4, 0.9, 0.0), Vec3::new(0.0, 0.0, PI / 2.0)] {
        let mut scene = floor_scene();
        // Long box: tilted, its true lowest corner differs from the unrotated AABB bottom
        let id = add_dynamic(&mut scene, PrimitiveKind::Box, Vec3::new(0.0, 4.0, 0.0), Vec3::new(3.0, 1.0, 1.0), euler);
        run(&mut scene, 240);
        let (lo, _) = y_range(&scene, id);
        assert!((lo - -1.0).abs() < EPS, "euler {euler:?}: lowest corner at {lo}, floor at -1");
        assert!(scene.find_object(id).unwrap().body.velocity.length() < 1.0);
    }
}

#[test]
fn spinning_box_settles_on_the_floor() {
    let mut scene = floor_scene();
    let id = add_dynamic(&mut scene, PrimitiveKind::Box, Vec3::new(0.0, 3.0, 0.0), Vec3::splat(2.0), Vec3::ZERO);
    scene.find_object_mut(id).unwrap().body.angular_velocity = Vec3::new(2.0, 1.0, 3.0);
    run(&mut scene, 400);
    let obj = scene.find_object(id).unwrap();
    assert!(obj.body.angular_velocity.length() < 0.05, "spin {:?}", obj.body.angular_velocity);
    let (lo, _) = y_range(&scene, id);
    assert!((lo - -1.0).abs() < EPS, "lowest corner at {lo}");
}

#[test]
fn cylinder_on_its_side_rests_on_its_bounding_box() {
    let mut scene = floor_scene();
    // Radius 1 (scale 2) lying along x: axis center must settle at floor + radius
    let id = add_dynamic(&mut scene, PrimitiveKind::Cylinder, Vec3::new(0.0, 3.0, 0.0), Vec3::new(2.0, 4.0, 2.0), Vec3::new(0.0, 0.0, PI / 2.0));
    run(&mut scene, 240);
    let y = scene.find_object(id).unwrap().transform.position.y;
    assert!((y - 0.0).abs() < EPS, "cylinder center at {y}");
}

#[test]
fn stacked_rotated_boxes_touch_each_other_and_the_floor() {
    let mut scene = floor_scene();
    // Bottom: 2 x 1 x 1 stood on end (90 deg about z) -> 2 tall; top: unit cube yawed 45 deg
    let bottom = add_dynamic(&mut scene, PrimitiveKind::Box, Vec3::new(0.0, 1.5, 0.0), Vec3::new(2.0, 1.0, 1.0), Vec3::new(0.0, 0.0, PI / 2.0));
    let top = add_dynamic(&mut scene, PrimitiveKind::Box, Vec3::new(0.0, 4.0, 0.0), Vec3::ONE, Vec3::new(0.0, PI / 4.0, 0.0));
    run(&mut scene, 300);
    let (b_lo, b_hi) = y_range(&scene, bottom);
    let (t_lo, t_hi) = y_range(&scene, top);
    assert!((b_lo - -1.0).abs() < EPS, "bottom box lowest corner {b_lo}");
    assert!((b_hi - 1.0).abs() < EPS, "bottom box top {b_hi}");
    assert!((t_lo - b_hi).abs() < EPS, "top box hovers / sinks: {t_lo} vs {b_hi}");
    assert!((t_hi - 2.0).abs() < 2.0 * EPS);
}

#[test]
fn sphere_rolls_without_slipping_on_a_tilted_box_surface() {
    // A long isolated ramp: rolling travels much farther than the old velocity damping,
    // so the floor / ramp edge must not interrupt the contact being measured.
    let mut scene = SceneWorld::new();
    let tilt = 0.35f32;
    let ramp = scene.add_primitive(PrimitiveKind::Box, Vec3::new(0.0, 2.0, 0.0), Vec3::new(100.0, 1.0, 30.0), [0.5; 4], BodyType::Static);
    scene.find_object_mut(ramp).unwrap().transform.euler_radians = Vec3::new(0.0, 0.0, tilt);
    let ball = add_dynamic(&mut scene, PrimitiveKind::Sphere, Vec3::new(0.0, 5.0, 0.0), Vec3::splat(2.0), Vec3::ZERO);
    let start_x = scene.find_object(ball).unwrap().transform.position.x;
    for step in 0..120 {
        scene.step_physics(DT);
        if step < 60 {
            continue;
        }
        // Distance from the ball center to the ramp's top face plane must be the radius (1)
        let m = scene.world_matrix_of(ramp);
        let up = m.y_axis.truncate().normalize();
        let top_point = m.transform_point3(Vec3::new(0.0, 0.5, 0.0));
        let c = scene.find_object(ball).unwrap().transform.position;
        let dist = (c - top_point).dot(up);
        assert!((dist - 1.0).abs() < EPS, "step {step}: ball center {dist} above the slope");
    }
    let obj = scene.find_object(ball).unwrap();
    assert!(obj.transform.position.x < start_x);
    assert!(obj.body.angular_velocity.z > 1.0, "the ball must acquire spin from friction");
    let up = scene.world_matrix_of(ramp).y_axis.truncate().normalize();
    let surface_velocity = obj.body.velocity + obj.body.angular_velocity.cross(-up);
    assert!(surface_velocity.length() < 0.05, "rolling contact slips: {surface_velocity:?}");
}

#[test]
fn off_center_impact_transfers_spin_and_conserves_momentum() {
    for offset in [0.0, 0.6, -0.6] {
        let mut scene = SceneWorld::new();
        scene.gravity = Vec3::ZERO;
        let box_id = add_dynamic(&mut scene, PrimitiveKind::Box, Vec3::ZERO, Vec3::splat(2.0), Vec3::ZERO);
        let ball = add_dynamic(&mut scene, PrimitiveKind::Sphere, Vec3::new(-1.4, offset, 0.0), Vec3::ONE, Vec3::ZERO);
        for (id, mass) in [(box_id, 3.0), (ball, 1.0)] {
            let body = &mut scene.find_object_mut(id).unwrap().body;
            body.mass = mass;
            body.friction = 0.0;
            body.restitution = 1.0;
        }
        scene.find_object_mut(ball).unwrap().body.velocity = Vec3::X * 6.0;
        // One substep, so only the documented linear air drag precedes the impact.
        let incoming = 6.0 * 0.995_f32.sqrt();
        let energy = scene.step_physics(1.0 / 120.0);
        let a = scene.find_object(box_id).unwrap();
        let b = scene.find_object(ball).unwrap();
        assert!((a.body.velocity * 3.0 + b.body.velocity - Vec3::X * incoming).length() < 1e-4);
        // Box Iz = m*(width^2 + height^2)/12 = 2, sphere has no frictional spin.
        let angular_momentum = a.transform.position.cross(a.body.velocity * 3.0)
            + b.transform.position.cross(b.body.velocity) + a.body.angular_velocity * 2.0;
        assert!((angular_momentum.z + offset * incoming).abs() < 1e-4, "L = {angular_momentum:?}");
        assert!((energy - 0.5 * incoming * incoming).abs() < 1e-3, "elastic impact energy {energy}");
        if offset == 0.0 {
            assert!(a.body.angular_velocity.length() < 1e-5, "centered impact must not create spin");
        } else {
            assert!(a.body.angular_velocity.z * offset < -0.1, "off-center impact must spin the box");
        }
        assert!(b.body.angular_velocity.length() < 1e-5);
    }
}

#[test]
fn tilted_box_tips_onto_a_face_from_zero_spin() {
    let mut scene = floor_scene();
    let id = add_dynamic(&mut scene, PrimitiveKind::Box, Vec3::new(0.0, 3.0, 0.0), Vec3::new(3.0, 1.0, 1.0), Vec3::new(0.0, 0.0, 0.45));
    let mut max_spin = 0.0_f32;
    for _ in 0..360 {
        scene.step_physics(DT);
        max_spin = max_spin.max(scene.find_object(id).unwrap().body.angular_velocity.length());
    }
    let obj = scene.find_object(id).unwrap();
    assert!(max_spin > 0.5, "floor contact must create torque");
    let up = obj.transform.rotation_quat() * Vec3::Y;
    assert!(up.dot(Vec3::Y).abs() > 0.99, "box should settle on its broad face: {up:?}");
    assert!(obj.body.angular_velocity.length() < 0.05);
}

#[test]
fn floor_friction_converts_sliding_to_rolling_but_frictionless_floor_does_not() {
    for friction in [0.0, 0.85] {
        let mut scene = floor_scene();
        let id = add_dynamic(&mut scene, PrimitiveKind::Sphere, Vec3::ZERO, Vec3::splat(2.0), Vec3::ZERO);
        let body = &mut scene.find_object_mut(id).unwrap().body;
        body.velocity = Vec3::X * 8.0;
        body.friction = friction;
        body.restitution = 0.0;
        run(&mut scene, 60);
        let body = scene.find_object(id).unwrap().body;
        if friction == 0.0 {
            assert!(body.angular_velocity.length() < 1e-6);
        } else {
            assert!(body.angular_velocity.z < -1.0);
            assert!((body.velocity + body.angular_velocity.cross(-Vec3::Y)).length() < 0.02);
        }
    }
}

#[test]
fn spin_uses_world_axes_and_contributes_to_kinetic_energy() {
    let mut scene = SceneWorld::new();
    scene.gravity = Vec3::ZERO;
    let id = add_dynamic(&mut scene, PrimitiveKind::Sphere, Vec3::ZERO, Vec3::splat(2.0), Vec3::new(0.5, 0.8, -0.3));
    let omega = Vec3::new(1.5, -2.0, 0.7);
    scene.find_object_mut(id).unwrap().body.angular_velocity = omega;
    let initial = scene.find_object(id).unwrap().transform.rotation_quat();
    let energy = scene.step_physics(DT);
    let obj = scene.find_object(id).unwrap();
    let expected = Quat::from_scaled_axis(omega * DT) * initial;
    assert!(obj.transform.rotation_quat().dot(expected).abs() > 0.99999);
    // Solid sphere: I = 2/5*m*r^2; generated mass = 8 and radius = 1.
    assert!((energy - 0.5 * 3.2 * omega.length_squared()).abs() < 1e-4);
}

#[test]
fn kinematic_surface_transfers_motion_through_contact_friction() {
    let mut scene = SceneWorld::new();
    let floor = scene.add_primitive(PrimitiveKind::Box, Vec3::new(0.0, -1.0, 0.0), Vec3::new(30.0, 1.0, 30.0), [0.3; 4], BodyType::Kinematic);
    scene.find_object_mut(floor).unwrap().body.velocity = Vec3::X * 2.0;
    let ball = add_dynamic(&mut scene, PrimitiveKind::Sphere, Vec3::ZERO, Vec3::ONE, Vec3::ZERO);
    run(&mut scene, 30);
    let body = scene.find_object(ball).unwrap().body;
    assert!(body.velocity.x > 0.1 && body.angular_velocity.z > 0.1);
    let contact_velocity = body.velocity + body.angular_velocity.cross(-Vec3::Y * 0.5);
    assert!((contact_velocity.x - 2.0).abs() < 0.02, "contact velocity {contact_velocity:?}");
    assert_eq!(scene.find_object(floor).unwrap().body.velocity, Vec3::X * 2.0);
}

#[test]
fn contact_response_rotates_with_an_anisotropic_body() {
    let impact = |euler: Vec3| {
        let mut scene = SceneWorld::new();
        scene.gravity = Vec3::ZERO;
        let box_id = add_dynamic(&mut scene, PrimitiveKind::Box, Vec3::ZERO, Vec3::new(2.0, 3.0, 1.0), euler);
        let rotation = scene.find_object(box_id).unwrap().transform.rotation_quat();
        let ball = add_dynamic(&mut scene, PrimitiveKind::Sphere, rotation * Vec3::new(-1.4, 0.6, 0.0), Vec3::ONE, Vec3::ZERO);
        for id in [box_id, ball] {
            scene.find_object_mut(id).unwrap().body.friction = 0.0;
        }
        scene.find_object_mut(ball).unwrap().body.velocity = rotation * Vec3::X * 6.0;
        scene.step_physics(1.0 / 120.0);
        (rotation, scene.find_object(box_id).unwrap().body)
    };
    let (_, original) = impact(Vec3::ZERO);
    let (rotation, rotated) = impact(Vec3::new(0.4, 0.7, -0.2));
    assert!((rotated.velocity - rotation * original.velocity).length() < 1e-4);
    assert!((rotated.angular_velocity - rotation * original.angular_velocity).length() < 1e-4);
}

#[test]
fn offset_box_face_impact_generates_spin_without_spurious_centered_spin() {
    for offset in [0.0, 0.7, -0.7] {
        let mut scene = SceneWorld::new();
        scene.gravity = Vec3::ZERO;
        let target = add_dynamic(&mut scene, PrimitiveKind::Box, Vec3::ZERO, Vec3::ONE, Vec3::ZERO);
        let striker = add_dynamic(&mut scene, PrimitiveKind::Box, Vec3::new(-0.95, offset, 0.0), Vec3::ONE, Vec3::ZERO);
        for id in [target, striker] {
            let body = &mut scene.find_object_mut(id).unwrap().body;
            body.friction = 0.0;
            body.restitution = 0.0;
        }
        scene.find_object_mut(striker).unwrap().body.velocity = Vec3::X * 5.0;
        let energy = scene.step_physics(1.0 / 120.0);
        let body = scene.find_object(target).unwrap().body;
        if offset == 0.0 {
            assert!(body.angular_velocity.length() < 1e-4, "symmetric manifold: {:?}", body.angular_velocity);
        } else {
            assert!(body.angular_velocity.z * offset < -0.1, "offset manifold: {:?}", body.angular_velocity);
        }
        assert!(energy < 12.5, "inelastic impact must not add energy");
    }
}

#[test]
fn obb_contacts_have_finite_manifolds_for_random_orientations() {
    let mut rng = DeterministicRng::new(381);
    for _ in 0..1000 {
        let mut make_box = || {
            let r = Mat3::from_quat(Quat::from_euler(glam::EulerRot::XYZ, rng.next_range(-3.0, 3.0), rng.next_range(-3.0, 3.0), rng.next_range(-3.0, 3.0)));
            Collider {
                center: Vec3::new(rng.next_range(-1.0, 1.0), rng.next_range(-1.0, 1.0), rng.next_range(-1.0, 1.0)),
                shape: Shape::Obb { axes: [r.x_axis, r.y_axis, r.z_axis], half: Vec3::new(1.0, 0.6, 0.3) },
            }
        };
        let (a, b) = (make_box(), make_box());
        if let Some(c) = collision::collide(&a, &b) {
            assert!(!c.points.is_empty() && c.points.len() <= 8, "{c:?}");
            assert!(c.points.iter().all(|p| p.is_finite()));
            let reverse = collision::collide(&b, &a).unwrap();
            assert!((c.normal + reverse.normal).length() < 1e-4);
        }
    }
}

#[test]
fn rigid_simulation_is_deterministic() {
    let build = || {
        let mut scene = floor_scene();
        let mut rng = DeterministicRng::new(7);
        for i in 0..20 {
            let kind = [PrimitiveKind::Box, PrimitiveKind::Sphere, PrimitiveKind::Cylinder][i % 3];
            let pos = Vec3::new(rng.next_range(-4.0, 4.0), rng.next_range(1.0, 12.0), rng.next_range(-4.0, 4.0));
            let euler = Vec3::new(rng.next_range(-1.0, 1.0), rng.next_range(-1.0, 1.0), rng.next_range(-1.0, 1.0));
            add_dynamic(&mut scene, kind, pos, Vec3::splat(rng.next_range(0.6, 1.8)), euler);
        }
        run(&mut scene, 200);
        scene.objects().iter().map(|o| o.transform.position).collect::<Vec<_>>()
    };
    let a = build();
    assert_eq!(a, build());
    // Nothing tunneled through the floor
    assert!(a[1..].iter().all(|p| p.y > -1.0 && p.is_finite()), "{a:?}");
}

#[test]
fn sweep_broad_phase_matches_brute_force_on_random_scenes() {
    for seed in 1..=25u32 {
        let mut rng = DeterministicRng::new(seed);
        let n = 5 + (seed as usize * 7) % 60;
        let mut boxes = Vec::with_capacity(n);
        let mut dynamic = Vec::with_capacity(n);
        let mut group = Vec::with_capacity(n);
        for i in 0..n {
            let c = Vec3::new(rng.next_range(-10.0, 10.0), rng.next_range(-10.0, 10.0), rng.next_range(-10.0, 10.0));
            let h = Vec3::new(rng.next_range(0.1, 3.0), rng.next_range(0.1, 3.0), rng.next_range(0.1, 3.0));
            boxes.push((c - h, c + h));
            dynamic.push(rng.next_f32() < 0.7);
            // Some objects share a hierarchy root
            group.push(if rng.next_f32() < 0.2 { 0 } else { i });
        }
        // A huge floor overlapping everything, like a ground plane
        boxes.push((Vec3::splat(-100.0), Vec3::new(100.0, -9.0, 100.0)));
        dynamic.push(false);
        group.push(n);
        let mut order = Vec::new();
        let mut pairs = Vec::new();
        collision::sweep_pairs(&boxes, &dynamic, &group, &mut order, &mut pairs);
        assert_eq!(pairs, collision::brute_force_pairs(&boxes, &dynamic, &group), "seed {seed}");
    }
}

#[test]
fn obb_sat_reports_separation_normal_and_depth() {
    let unit = |center: Vec3, axes: [Vec3; 3]| Collider { center, shape: Shape::Obb { axes, half: Vec3::splat(0.5) } };
    let world_axes = [Vec3::X, Vec3::Y, Vec3::Z];
    // 45 deg about z: corner reaches 0.707 below the center
    let r = Mat3::from_rotation_z(PI / 4.0);
    let diamond = [r.x_axis, r.y_axis, r.z_axis];
    let ground = Collider { center: Vec3::new(0.0, -5.0, 0.0), shape: Shape::Obb { axes: world_axes, half: Vec3::new(10.0, 5.0, 10.0) } };
    let c = collision::collide(&ground, &unit(Vec3::new(0.0, 0.6, 0.0), diamond)).expect("corner dips 0.107 in");
    assert!((c.normal - Vec3::Y).length() < 1e-4 && (c.depth - (0.5f32.sqrt() - 0.6)).abs() < 1e-4, "{c:?}");
    // The unrotated AABB of the same box would already be clear here
    assert!(collision::collide(&ground, &unit(Vec3::new(0.0, 0.75, 0.0), diamond)).is_none());
    // Reversed argument order flips the normal
    let flipped = collision::collide(&unit(Vec3::new(0.0, 0.6, 0.0), diamond), &ground).unwrap();
    assert!((flipped.normal + Vec3::Y).length() < 1e-4);
    // Sphere vs rotated box face
    let ball = Collider { center: Vec3::new(0.0, 0.9, 0.0), shape: Shape::Sphere { radius: 0.3 } };
    let c = collision::collide(&unit(Vec3::ZERO, diamond), &ball).expect("sphere touches the corner");
    assert!((c.depth - (0.3 - (0.9 - 0.5f32.sqrt()))).abs() < 1e-4 && c.normal.y > 0.99, "{c:?}");
}

#[test]
fn parented_bodies_do_not_collide_with_their_own_hierarchy() {
    let mut scene = floor_scene();
    let parent = add_dynamic(&mut scene, PrimitiveKind::Box, Vec3::new(0.0, 2.0, 0.0), Vec3::ONE, Vec3::ZERO);
    let child = scene.add_primitive(PrimitiveKind::Sphere, Vec3::new(0.3, 0.0, 0.0), Vec3::ONE, [1.0; 4], BodyType::Static);
    assert!(scene.set_object_parent(child, Some(parent)));
    run(&mut scene, 120);
    let p = scene.find_object(parent).unwrap().transform.position;
    // Overlapping child must not shove its parent sideways
    assert!(p.x.abs() < 1e-3 && p.z.abs() < 1e-3, "parent drifted to {p:?}");
}

#[test]
fn raycast_hits_a_scaled_plane_at_its_surface() {
    let scene = floor_scene();
    let ray = Ray::new(Vec3::new(3.0, 20.0, 2.0), Vec3::new(0.0, -1.0, 0.0));
    let (_, hit) = scene.raycast_object_silent(&ray).expect("hits the floor");
    assert!((hit.y - -1.0).abs() < 1e-4, "hit y {}", hit.y);
    // Grazing / outside rays miss
    assert!(scene.raycast_object_silent(&Ray::new(Vec3::new(0.0, -1.0, -50.0), Vec3::Z)).is_none());
    assert!(scene.raycast_object_silent(&Ray::new(Vec3::new(40.0, 20.0, 0.0), Vec3::new(0.0, -1.0, 0.0))).is_none());
    // Tilted plane: hit lies on its rotated surface
    let mut scene = SceneWorld::new();
    let id = scene.add_primitive(PrimitiveKind::Plane, Vec3::ZERO, Vec3::new(10.0, 3.0, 10.0), [1.0; 4], BodyType::Static);
    scene.find_object_mut(id).unwrap().transform.euler_radians = Vec3::new(0.0, 0.0, PI / 4.0);
    let (_, hit) = scene.raycast_object_silent(&Ray::new(Vec3::new(1.0, 10.0, 0.0), Vec3::new(0.0, -1.0, 0.0))).unwrap();
    assert!((hit.y - 1.0).abs() < 1e-4, "tilted hit {hit:?}");
}

#[test]
fn plane_mesh_top_face_is_the_surface() {
    let (verts, _) = build_unit_plane();
    let top = verts.iter().map(|v| v.position.y).fold(f32::NEG_INFINITY, f32::max);
    assert!(top.abs() < 1e-6, "plane mesh top at {top}");
}

#[test]
fn selecting_a_floor_or_large_static_object_outlines_without_tinting() {
    let mut scene = floor_scene();
    let wall = scene.add_primitive(PrimitiveKind::Box, Vec3::new(0.0, 5.0, -20.0), Vec3::new(40.0, 10.0, 1.0), [0.4, 0.4, 0.4, 1.0], BodyType::Static);
    let crate_id = scene.add_primitive(PrimitiveKind::Box, Vec3::new(0.0, 0.0, 0.0), Vec3::ONE, [0.4, 0.4, 0.4, 1.0], BodyType::Static);
    // Instances are batched per mesh: find the object's by its model matrix
    let emissive_of = |scene: &mut SceneWorld, id: u32| {
        let model = scene.world_matrix_of(id).to_cols_array_2d();
        let packed = scene.pack_render_data(Vec3::new(0.0, 10.0, 30.0));
        let inst = packed.instances.iter().find(|i| i.model == model).unwrap();
        (inst.material[2], inst.color, packed.helper_lines.len())
    };
    for id in [1, wall] {
        scene.select_object(None);
        let (base_e, base_c, base_lines) = emissive_of(&mut scene, id);
        scene.select_object(Some(id));
        let (e, c, lines) = emissive_of(&mut scene, id);
        assert_eq!((e, c), (base_e, base_c), "object {id} tinted on selection");
        assert_eq!(lines, base_lines + 24, "object {id} lost its outline");
        // Hover over the floor (pointer moves) must not flood it either
        scene.hovered_object = Some(id);
        assert_eq!(emissive_of(&mut scene, id).0, base_e);
        scene.hovered_object = None;
    }
    // Ordinary objects keep the emissive selection tint
    scene.select_object(None);
    let base_e = emissive_of(&mut scene, crate_id).0;
    scene.select_object(Some(crate_id));
    assert!(emissive_of(&mut scene, crate_id).0 > base_e);
}
