//! CPU skinning (glTF skins): weight normalization, blend math, validation, partial vertex
//! uploads, posed bounds, shadows and picking.

use super::*;

/// A vertical strip of `rows` + 1 vertex pairs from y = 0 to y = 2 (x = +-0.5), facing +z.
/// Vertices below y = 1 follow joint 0, above it joint 1, at y = 1 half / half.
fn strip(scene: &mut SceneWorld, rows: u32) -> (u32, Vec<u16>, Vec<f32>) {
    let mut positions = Vec::new();
    let mut normals = Vec::new();
    let mut joints = Vec::new();
    let mut weights = Vec::new();
    for r in 0..=rows {
        let y = 2.0 * r as f32 / rows as f32;
        for x in [-0.5f32, 0.5] {
            positions.extend([x, y, 0.0]);
            normals.extend([0.0, 0.0, 1.0]);
            joints.extend([0u16, 1, 0, 0]);
            let w1 = (y - 0.5).clamp(0.0, 1.0);
            weights.extend([1.0 - w1, w1, 0.0, 0.0]);
        }
    }
    let mut indices = Vec::new();
    for r in 0..rows {
        let a = r * 2;
        indices.extend([a, a + 1, a + 2, a + 1, a + 3, a + 2]);
    }
    let id = scene
        .add_custom_mesh(
            &positions,
            &normals,
            &indices,
            Vec3::ZERO,
            Vec3::ONE,
            [1.0; 4],
            BodyType::Static,
        )
        .unwrap();
    (id, joints, weights)
}

fn cols(m: Mat4) -> Vec<f32> {
    m.to_cols_array().to_vec()
}

fn vertex(p: Vec3, n: Vec3) -> LocalVertex {
    LocalVertex {
        position: p,
        normal: n,
        uv: [0.0; 2],
    }
}

#[test]
fn weights_are_clamped_and_normalized() {
    assert_eq!(
        normalize_weights([2.0, 2.0, 0.0, 0.0]),
        [0.5, 0.5, 0.0, 0.0]
    );
    assert_eq!(normalize_weights([0.0; 4]), [0.0; 4]);
    let w = normalize_weights([f32::NAN, -1.0, 3.0, 1.0]);
    assert_eq!(w, [0.0, 0.0, 0.75, 0.25]);
    // unorm8 rounding (255 + 1 = 256 / 255) comes out summing to 1
    let w = normalize_weights([128.0 / 255.0, 128.0 / 255.0, 0.0, 0.0]);
    assert!((w.iter().sum::<f32>() - 1.0).abs() < 1e-6);
}

#[test]
fn linear_blend_skinning_blends_positions_and_inverse_transposes_normals() {
    let palette = [
        Mat4::IDENTITY,
        Mat4::from_translation(Vec3::new(2.0, 0.0, 0.0)),
        Mat4::from_scale(Vec3::new(4.0, 1.0, 1.0)),
    ];
    let bind = [
        vertex(Vec3::new(1.0, 1.0, 0.0), Vec3::Y),
        vertex(
            Vec3::new(1.0, 1.0, 0.0),
            Vec3::new(1.0, 1.0, 0.0).normalize(),
        ),
        vertex(Vec3::new(3.0, 0.0, 0.0), Vec3::X),
    ];
    let joints = [[0, 1, 0, 0], [2, 0, 0, 0], [0, 0, 0, 0]];
    let weights = [[0.5, 0.5, 0.0, 0.0], [1.0, 0.0, 0.0, 0.0], [0.0; 4]];
    let mut out = bind;
    skin_vertices(&bind, &joints, &weights, &palette, &mut out);
    // Half identity, half +2 x
    assert!((out[0].position - Vec3::new(2.0, 1.0, 0.0)).length() < 1e-6);
    assert!((out[0].normal - Vec3::Y).length() < 1e-6);
    // x scaled by 4: a 45 degree normal tilts towards y (inverse transpose), not towards x
    assert!((out[1].position - Vec3::new(4.0, 1.0, 0.0)).length() < 1e-6);
    let expected = Vec3::new(0.25, 1.0, 0.0).normalize();
    assert!(
        (out[1].normal - expected).length() < 1e-6,
        "{:?}",
        out[1].normal
    );
    // Unweighted vertices keep the bind pose
    assert_eq!(out[2].position, bind[2].position);
    assert_eq!(out[2].normal, bind[2].normal);
}

#[test]
fn mirrored_joints_keep_normals_outward() {
    let palette = [Mat4::from_scale(Vec3::new(-1.0, 1.0, 1.0))];
    let bind = [vertex(Vec3::X, Vec3::X)];
    let mut out = bind;
    skin_vertices(
        &bind,
        &[[0; 4]],
        &[[1.0, 0.0, 0.0, 0.0]],
        &palette,
        &mut out,
    );
    assert_eq!(out[0].position, Vec3::NEG_X);
    assert!((out[0].normal - Vec3::NEG_X).length() < 1e-6);
}

#[test]
fn skins_are_validated() {
    let mut scene = SceneWorld::new();
    let (id, joints, weights) = strip(&mut scene, 2);
    let n = joints.len();
    assert_eq!(
        scene.set_object_skin(id, &joints[..n - 4], &weights, 2),
        Err("joints and weights must have 4 entries per vertex")
    );
    assert_eq!(
        scene.set_object_skin(id, &joints, &weights, 0),
        Err("joint count must be 1..=65536")
    );
    assert_eq!(
        scene.set_object_skin(id, &joints, &weights, 1),
        Err("joint index out of range")
    );
    // An out-of-range index without weight is harmless
    let mut j = joints.clone();
    j[2] = 99;
    assert_eq!(scene.set_object_skin(id, &j, &weights, 2), Ok(true));
    let boxed = scene.add_primitive(
        PrimitiveKind::Box,
        Vec3::ZERO,
        Vec3::ONE,
        [1.0; 4],
        BodyType::Static,
    );
    assert_eq!(
        scene.set_object_skin(boxed, &joints, &weights, 2),
        Ok(false)
    );
    assert_eq!(scene.set_object_skin(999, &joints, &weights, 2), Ok(false));
    assert!(scene.find_object(id).unwrap().skin.is_some());
    assert_eq!(scene.set_object_skin(id, &[], &[], 0), Ok(true));
    assert!(scene.find_object(id).unwrap().skin.is_none());
}

#[test]
fn joint_matrices_reskin_in_one_batch_and_skip_bad_entries() {
    let mut scene = SceneWorld::new();
    let (a, joints, weights) = strip(&mut scene, 2);
    let (b, _, _) = strip(&mut scene, 2);
    scene.set_object_skin(a, &joints, &weights, 2).unwrap();
    scene.set_object_skin(b, &joints, &weights, 2).unwrap();
    let lift = Mat4::from_translation(Vec3::new(0.0, 0.0, 3.0));
    let mut m = cols(Mat4::IDENTITY);
    m.extend(cols(lift));
    let both = [m.clone(), m.clone()].concat();
    assert_eq!(scene.set_object_joint_matrices(&[a, b], &[2, 2], &both), 2);
    // Top vertices (y = 2, weight 1 on joint 1) moved to z = 3, bottom ones stayed
    let posed = scene.skinned_vertices(a).unwrap();
    assert_eq!(posed.len(), 6 * 6);
    assert_eq!(posed[2], 0.0);
    assert_eq!(posed[6 * 4 + 2], 3.0);
    assert_eq!(posed[6 * 2 + 2], 1.5, "y = 1 is half / half");

    // Wrong count, unknown id, unskinned id, non-finite matrix: skipped; the batch continues
    let boxed = scene.add_primitive(
        PrimitiveKind::Box,
        Vec3::ZERO,
        Vec3::ONE,
        [1.0; 4],
        BodyType::Static,
    );
    let mut bad = cols(Mat4::IDENTITY);
    bad[0] = f32::NAN;
    bad.extend(cols(Mat4::IDENTITY));
    let ident = [cols(Mat4::IDENTITY), cols(Mat4::IDENTITY)].concat();
    let batch = [
        cols(Mat4::IDENTITY),
        cols(Mat4::IDENTITY),
        bad,
        ident.clone(),
    ]
    .concat();
    assert_eq!(
        scene.set_object_joint_matrices(
            &[a, 999, boxed, b, a],
            &[1, 1, 0, 2, 2],
            &[batch.clone(), vec![]].concat()
        ),
        1
    );
    assert_eq!(
        scene.skinned_vertices(b).unwrap()[6 * 4 + 2],
        3.0,
        "b kept its pose"
    );
    assert_eq!(
        scene.skinned_vertices(a).unwrap()[6 * 4 + 2],
        0.0,
        "the last entry reset a"
    );
    // A batch running past the matrices ends early
    assert_eq!(scene.set_object_joint_matrices(&[a], &[2], &ident[..16]), 0);
    assert_eq!(scene.skinned_vertices(boxed), None);
}

#[test]
fn reskinning_uploads_only_the_skinned_vertex_range() {
    let mut scene = SceneWorld::new();
    let _rigid = strip(&mut scene, 3);
    let (id, joints, weights) = strip(&mut scene, 2);
    scene.set_object_skin(id, &joints, &weights, 2).unwrap();
    let packed = scene.pack_render_data(Vec3::ZERO);
    let (bind_vertices, _) = packed.geometry.expect("first pack uploads everything");
    let bind_vertices = bind_vertices.to_vec();
    assert!(packed.vertex_updates.is_none());
    // Re-packing without a pose change uploads nothing
    scene.touch();
    let packed = scene.pack_render_data(Vec3::ZERO);
    assert!(packed.geometry.is_none() && packed.vertex_updates.is_none());

    let m = [
        cols(Mat4::IDENTITY),
        cols(Mat4::from_translation(Vec3::new(0.0, 0.0, 3.0))),
    ]
    .concat();
    assert_eq!(scene.set_object_joint_matrices(&[id], &[2], &m), 1);
    let packed = scene.pack_render_data(Vec3::ZERO);
    assert!(packed.geometry.is_none());
    let (vertices, ranges) = packed
        .vertex_updates
        .expect("pose change uploads the skinned range");
    // Box + sphere + plane + cylinder, then the rigid strip (8 vertices), then the skinned one (6)
    let start = (vertices.len() - 6) as u32;
    assert_eq!(ranges, &[(start, start + 6)]);
    assert_eq!(
        &vertices[..start as usize],
        &bind_vertices[..start as usize],
        "other meshes untouched"
    );
    let top = vertices[start as usize + 4];
    assert_eq!(top.position[2], 3.0);
    // uvs (w lanes) keep the bind-pose values
    assert_eq!(
        top.position[3],
        bind_vertices[start as usize + 4].position[3]
    );
    assert_eq!(top.normal[3], bind_vertices[start as usize + 4].normal[3]);

    // A full rebuild (new mesh) carries the posed vertices too
    strip(&mut scene, 1);
    let packed = scene.pack_render_data(Vec3::ZERO);
    let (vertices, _) = packed.geometry.unwrap();
    assert_eq!(vertices[start as usize + 4].position[2], 3.0);
    assert!(packed.vertex_updates.is_none());

    // Removing the skin restores the bind pose
    scene.set_object_skin(id, &[], &[], 0).unwrap();
    let packed = scene.pack_render_data(Vec3::ZERO);
    assert_eq!(
        packed.geometry.unwrap().0[start as usize + 4].position[2],
        0.0
    );
}

#[test]
fn unskinned_scenes_never_produce_vertex_updates() {
    let mut scene = SceneWorld::new();
    strip(&mut scene, 2);
    scene.pack_render_data(Vec3::ZERO);
    assert!(scene.set_object_transform(1, Vec3::X, Vec3::ZERO, Vec3::ONE));
    let packed = scene.pack_render_data(Vec3::ZERO);
    assert!(packed.geometry.is_none() && packed.vertex_updates.is_none());
}

#[test]
fn posed_bounds_drive_shadow_fit_and_picking() {
    let mut scene = SceneWorld::new();
    let (id, joints, weights) = strip(&mut scene, 8);
    scene.set_object_skin(id, &joints, &weights, 2).unwrap();
    // Bend the upper joint 90 degrees about z around (0, 1, 0): the top swings to x = -1
    let pivot = Vec3::new(0.0, 1.0, 0.0);
    let bend = Mat4::from_translation(pivot)
        * Mat4::from_rotation_z(std::f32::consts::FRAC_PI_2)
        * Mat4::from_translation(-pivot);
    let m = [cols(Mat4::IDENTITY), cols(bend)].concat();
    scene.set_object_joint_matrices(&[id], &[2], &m);
    let obj = scene.find_object(id).unwrap();
    let he = obj.base_half_extents();
    assert!(
        he.x >= 1.0 - 1e-5 && he.y >= 1.5 - 1e-5,
        "posed extents {he:?}"
    );
    let posed = scene.skinned_vertices(id).unwrap();
    for v in posed.chunks(6) {
        let p = Vec3::new(v[0], v[1], v[2]);
        assert!(p.abs().cmple(he + 1e-5).all(), "{p:?} outside {he:?}");
    }
    // Shadow bounds contain every posed vertex
    scene.shadows.enabled = true;
    scene.pack_render_data(Vec3::ZERO);
    let (c, r) = scene.shadow_bounds().unwrap();
    for v in posed.chunks(6) {
        assert!(Vec3::new(v[0], v[1], v[2]).distance(c) <= r + 1e-4);
    }
    // Picking follows the pose: the bent tip (x ~ -0.95 at y ~ 1.5) is hit from the front,
    // the rest-pose tip (0, 1.9) is not, and no BVH is built
    let hit = scene.raycast_object_silent(&Ray::new(Vec3::new(-0.95, 1.2, 10.0), Vec3::NEG_Z));
    assert_eq!(hit.map(|h| h.0), Some(id));
    assert!(scene
        .raycast_object_silent(&Ray::new(Vec3::new(0.0, 1.95, 10.0), Vec3::NEG_Z))
        .is_none());
    assert!(scene.find_object(id).unwrap().pick_cache.bvh().is_none());
}

/// Pose-update cost of a 10k-vertex, 40-joint skin (re-skin + pack of the dirty range). Run with
/// `cargo test --release -p charturbo-core skin_pose_update_perf -- --ignored --nocapture`.
#[test]
#[ignore]
fn skin_pose_update_perf() {
    let mut scene = SceneWorld::new();
    let (id, _, _) = strip(&mut scene, 4_999); // 10_000 vertices
    let joint_count = 40u32;
    let n = 10_000;
    let mut joints = Vec::with_capacity(n * 4);
    let mut weights = Vec::with_capacity(n * 4);
    for v in 0..n {
        let y = (v / 2) as f32 / 4_999.0 * (joint_count - 1) as f32;
        let j0 = (y.floor() as u16).min(joint_count as u16 - 2);
        let f = y - j0 as f32;
        joints.extend([j0, j0 + 1, 0, 0]);
        weights.extend([1.0 - f, f, 0.0, 0.0]);
    }
    scene
        .set_object_skin(id, &joints, &weights, joint_count)
        .unwrap();
    scene.pack_render_data(Vec3::ZERO);
    let frames = 200;
    let mut matrices = vec![0.0f32; joint_count as usize * 16];
    let (mut skin_s, mut pack_s) = (0.0f64, 0.0f64);
    for f in 0..frames {
        for j in 0..joint_count as usize {
            let m = Mat4::from_rotation_z(0.01 * (f as f32) * (j as f32 / 40.0));
            matrices[j * 16..j * 16 + 16].copy_from_slice(&m.to_cols_array());
        }
        let t0 = std::time::Instant::now();
        assert_eq!(
            scene.set_object_joint_matrices(&[id], &[joint_count], &matrices),
            1
        );
        let t1 = std::time::Instant::now();
        let packed = scene.pack_render_data(Vec3::ZERO);
        assert!(packed.vertex_updates.is_some());
        let t2 = std::time::Instant::now();
        skin_s += (t1 - t0).as_secs_f64();
        pack_s += (t2 - t1).as_secs_f64();
    }
    println!(
        "skin perf: {n} vertices, {joint_count} joints: re-skin {:.3} ms, pack (dirty range) {:.3} ms per update",
        skin_s * 1e3 / frames as f64,
        pack_s * 1e3 / frames as f64
    );
}
