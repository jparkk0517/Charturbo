//! Mesh matrices (animated glTF node chains): world composition, picking, packing, shadows.

use super::*;

/// A flat `n` x `n` grid of quads on local y = 0 spanning [-1, 1] (2 n^2 triangles).
fn grid(scene: &mut SceneWorld, n: u32) -> u32 {
    let mut positions = Vec::new();
    for j in 0..=n {
        for i in 0..=n {
            positions.extend([
                i as f32 / n as f32 * 2.0 - 1.0,
                0.0,
                j as f32 / n as f32 * 2.0 - 1.0,
            ]);
        }
    }
    let mut indices = Vec::new();
    for j in 0..n {
        for i in 0..n {
            let a = j * (n + 1) + i;
            indices.extend([a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2]);
        }
    }
    scene
        .add_custom_mesh(
            &positions,
            &[],
            &indices,
            Vec3::ZERO,
            Vec3::ONE,
            [1.0; 4],
            BodyType::Static,
        )
        .unwrap()
}

fn down_ray(x: f32, z: f32) -> Ray {
    Ray::new(Vec3::new(x, 50.0, z), Vec3::NEG_Y)
}

#[test]
fn mesh_matrix_composes_after_the_object_transform_and_is_not_inherited() {
    let mut scene = SceneWorld::new();
    let parent = grid(&mut scene, 2);
    let child = scene.add_primitive(
        PrimitiveKind::Box,
        Vec3::new(0.0, 1.0, 0.0),
        Vec3::ONE,
        [1.0; 4],
        BodyType::Static,
    );
    assert!(scene.set_object_parent(child, Some(parent)));
    assert!(scene.set_object_transform(
        parent,
        Vec3::new(10.0, 0.0, 0.0),
        Vec3::new(0.0, FRAC_PI_2, 0.0),
        Vec3::splat(2.0)
    ));
    let mesh = Mat4::from_translation(Vec3::new(1.0, 0.0, 0.0))
        * Mat4::from_scale(Vec3::new(1.0, 3.0, 1.0));
    assert_eq!(
        scene.set_object_mesh_matrices(&[parent], &mesh.to_cols_array()),
        1
    );

    let trs = scene.find_object(parent).unwrap().transform.local_matrix();
    let world = scene.world_matrix_of(parent);
    assert!(world.abs_diff_eq(trs * mesh, 1e-5));
    // The child follows the TRS chain only
    let child_world = scene.world_matrix_of(child);
    assert!(child_world.abs_diff_eq(trs * Mat4::from_translation(Vec3::Y), 1e-5));

    // Packed instances use the same matrices
    let packed = scene.pack_render_data(Vec3::new(0.0, 5.0, 30.0));
    let models: Vec<Mat4> = packed
        .instances
        .iter()
        .map(|i| Mat4::from_cols_array_2d(&i.model))
        .collect();
    assert!(models.iter().any(|m| m.abs_diff_eq(trs * mesh, 1e-5)));
    assert!(models.iter().any(|m| m.abs_diff_eq(child_world, 1e-5)));

    // The user TRS is untouched by mesh matrices
    let t = scene.find_object(parent).unwrap().transform;
    assert_eq!(t.position, Vec3::new(10.0, 0.0, 0.0));
    assert_eq!(t.scale, Vec3::splat(2.0));
}

#[test]
fn identity_clears_and_unknown_ids_or_partial_matrices_are_skipped() {
    let mut scene = SceneWorld::new();
    let a = grid(&mut scene, 1);
    let b = grid(&mut scene, 1);
    let m = Mat4::from_translation(Vec3::new(0.0, 2.0, 0.0)).to_cols_array();
    let mut data = m.to_vec();
    data.extend(m);
    data.extend(&m[..8]);
    let before = scene.revision();
    // 99 is unknown; the third matrix is partial
    assert_eq!(scene.set_object_mesh_matrices(&[a, 99, b], &data), 1);
    assert!(scene.revision() != before);
    assert!(scene
        .find_object(a)
        .unwrap()
        .transform
        .mesh_matrix
        .is_some());
    assert!(scene
        .find_object(b)
        .unwrap()
        .transform
        .mesh_matrix
        .is_none());

    assert_eq!(
        scene.set_object_mesh_matrices(&[a], &Mat4::IDENTITY.to_cols_array()),
        1
    );
    assert!(scene
        .find_object(a)
        .unwrap()
        .transform
        .mesh_matrix
        .is_none());
    let mut nan = Mat4::IDENTITY.to_cols_array();
    nan[12] = f32::NAN;
    scene.set_object_mesh_matrices(&[a], &m);
    scene.set_object_mesh_matrices(&[a], &nan);
    assert!(scene
        .find_object(a)
        .unwrap()
        .transform
        .mesh_matrix
        .is_none());
    // Nothing applied: the revision stays
    let r = scene.revision();
    assert_eq!(scene.set_object_mesh_matrices(&[99], &m), 0);
    assert_eq!(scene.revision(), r);
}

#[test]
fn picking_follows_mesh_matrices_without_rebuilding_the_bvh() {
    let mut scene = SceneWorld::new();
    let id = grid(&mut scene, 8); // 128 triangles: BVH path
    assert_eq!(
        scene
            .raycast_object_silent(&down_ray(0.5, 0.5))
            .map(|h| h.0),
        Some(id)
    );
    let bvh_before = scene
        .find_object(id)
        .unwrap()
        .pick_cache
        .bvh()
        .map(|b| b as *const _);
    assert!(bvh_before.is_some());

    let mut last = None;
    for step in 1..=5 {
        let x = step as f32 * 4.0;
        let m = Mat4::from_translation(Vec3::new(x, 1.0, 0.0)) * Mat4::from_rotation_z(0.0);
        scene.set_object_mesh_matrices(&[id], &m.to_cols_array());
        let hit = scene.raycast_object_silent(&down_ray(x + 0.5, 0.5));
        assert_eq!(hit.map(|h| h.0), Some(id), "step {step}");
        assert!((hit.unwrap().1.y - 1.0).abs() < 1e-4);
        assert!(scene.raycast_object_silent(&down_ray(0.5, 0.5)).is_none());
        last = scene
            .find_object(id)
            .unwrap()
            .pick_cache
            .bvh()
            .map(|b| b as *const _);
    }
    assert_eq!(last, bvh_before, "the local-space BVH is reused");

    // A rotated (sheared by non-uniform scale) chain still picks exactly
    let m = Mat4::from_rotation_y(0.7)
        * Mat4::from_scale(Vec3::new(3.0, 1.0, 0.5))
        * Mat4::from_rotation_y(0.4);
    scene.set_object_mesh_matrices(&[id], &m.to_cols_array());
    let p = m.transform_point3(Vec3::new(0.6, 0.0, -0.3));
    let hit = scene.raycast_object_silent(&down_ray(p.x, p.z)).unwrap();
    assert_eq!(hit.0, id);
    assert!((hit.1 - p).length() < 1e-3);
}

#[test]
fn mesh_matrix_updates_repack_instances_but_not_geometry_and_move_shadow_bounds() {
    let mut scene = SceneWorld::new();
    let id = grid(&mut scene, 2);
    assert!(scene.pack_render_data(Vec3::Z).geometry.is_some());
    let (c0, _) = scene.shadow_bounds().unwrap();
    let m = Mat4::from_translation(Vec3::new(20.0, 0.0, 0.0));
    scene.set_object_mesh_matrices(&[id], &m.to_cols_array());
    let packed = scene.pack_render_data(Vec3::Z);
    assert!(
        packed.geometry.is_none(),
        "matrix updates never re-upload geometry"
    );
    assert!(Mat4::from_cols_array_2d(&packed.instances[0].model).abs_diff_eq(m, 1e-6));
    let (c1, _) = scene.shadow_bounds().unwrap();
    assert!((c1 - c0 - Vec3::new(20.0, 0.0, 0.0)).length() < 1e-4);
}

use std::f32::consts::FRAC_PI_2;
