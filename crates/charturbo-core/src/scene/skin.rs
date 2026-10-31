//! CPU linear-blend skinning of custom meshes (glTF skins).
//!
//! A skinned object keeps its bind-pose vertices in `SceneGeometry::Custom` and a posed copy
//! here. Every joint-matrix update re-skins the posed copy (positions + normals, O(vertices)),
//! refreshes the posed bounds and marks the object's vertex range for a partial upload. All
//! render passes (classic / PBR / HDR / MSAA, directional and point shadow depth) read the shared
//! vertex buffer, so they draw the posed mesh with no shader or pipeline variant; picking scans
//! the posed triangles (the bind-pose BVH is not used and never rebuilt).

use super::LocalVertex;
use glam::{Mat3, Mat4, Vec3, Vec4};

/// Most joints one skin may reference (joint indices are 16-bit).
pub const MAX_SKIN_JOINTS: u32 = 65_536;

/// Influences per vertex (glTF `JOINTS_0` / `WEIGHTS_0`).
pub const SKIN_INFLUENCES: usize = 4;

/// Joint indices and normalized weights of a custom mesh, plus its current pose.
#[derive(Debug, Clone)]
pub struct Skin {
    joints: Vec<[u16; SKIN_INFLUENCES]>,
    weights: Vec<[f32; SKIN_INFLUENCES]>,
    /// Current joint matrices (object space; identity = bind pose)
    palette: Vec<Mat4>,
    /// Skinned vertices (positions + normals; uvs are not used)
    pub(crate) posed: Vec<LocalVertex>,
    /// Symmetric local half extents of the posed vertices (like `local_half_extents`)
    pub(crate) half_extents: Vec3,
    /// Posed vertices changed since the last pack (their range needs an upload)
    pub(crate) dirty: bool,
}

/// Weights clamped to >= 0 (non-finite = 0) and scaled to sum to 1. All-zero weights stay zero:
/// such vertices keep their bind-pose position.
pub fn normalize_weights(w: [f32; SKIN_INFLUENCES]) -> [f32; SKIN_INFLUENCES] {
    let w = w.map(|v| if v.is_finite() && v > 0.0 { v } else { 0.0 });
    let sum: f32 = w.iter().sum();
    if sum > 1e-12 {
        w.map(|v| v / sum)
    } else {
        [0.0; SKIN_INFLUENCES]
    }
}

impl Skin {
    /// `joints` / `weights`: 4 per vertex. Errors on a length mismatch, a joint count outside
    /// 1..=`MAX_SKIN_JOINTS`, or a joint index >= `joint_count` with a non-zero weight.
    pub fn new(
        bind: &[LocalVertex],
        joints: &[u16],
        weights: &[f32],
        joint_count: u32,
    ) -> Result<Self, &'static str> {
        if joint_count == 0 || joint_count > MAX_SKIN_JOINTS {
            return Err("joint count must be 1..=65536");
        }
        let n = bind.len();
        if joints.len() != n * SKIN_INFLUENCES || weights.len() != n * SKIN_INFLUENCES {
            return Err("joints and weights must have 4 entries per vertex");
        }
        let mut j_out = Vec::with_capacity(n);
        let mut w_out = Vec::with_capacity(n);
        for (j, w) in joints
            .as_chunks::<4>()
            .0
            .iter()
            .zip(weights.as_chunks::<4>().0)
        {
            let w = normalize_weights(*w);
            let mut j = *j;
            for k in 0..SKIN_INFLUENCES {
                if w[k] == 0.0 {
                    j[k] = 0; // unused influence: any valid index
                } else if u32::from(j[k]) >= joint_count {
                    return Err("joint index out of range");
                }
            }
            j_out.push(j);
            w_out.push(w);
        }
        let mut skin = Self {
            joints: j_out,
            weights: w_out,
            palette: vec![Mat4::IDENTITY; joint_count as usize],
            posed: bind.to_vec(),
            half_extents: Vec3::ZERO,
            dirty: true,
        };
        skin.half_extents = posed_half_extents(&skin.posed);
        Ok(skin)
    }

    pub fn joint_count(&self) -> usize {
        self.palette.len()
    }

    /// Replaces the joint matrices (16 column-major floats each, exactly `joint_count` of them)
    /// and re-skins. False (pose unchanged) on a count mismatch or a non-finite matrix.
    pub fn set_joint_matrices(&mut self, bind: &[LocalVertex], matrices: &[f32]) -> bool {
        if matrices.len() != self.palette.len() * 16 || !matrices.iter().all(|v| v.is_finite()) {
            return false;
        }
        for (m, cols) in self.palette.iter_mut().zip(matrices.as_chunks::<16>().0) {
            *m = Mat4::from_cols_array(cols);
        }
        self.apply(bind);
        true
    }

    /// Recomputes the posed vertices and bounds from the bind pose and the palette.
    fn apply(&mut self, bind: &[LocalVertex]) {
        skin_vertices(
            bind,
            &self.joints,
            &self.weights,
            &self.palette,
            &mut self.posed,
        );
        self.half_extents = posed_half_extents(&self.posed);
        self.dirty = true;
    }
}

/// Linear-blend skinning: position = sum(w_i * M_i) * p, normal = cofactor(sum(w_i * M_i)) * n
/// (the inverse transpose up to scale: exact under non-uniform joint scale), renormalized.
/// Vertices without weights keep their bind position / normal. `out` must match `bind`.
pub fn skin_vertices(
    bind: &[LocalVertex],
    joints: &[[u16; SKIN_INFLUENCES]],
    weights: &[[f32; SKIN_INFLUENCES]],
    palette: &[Mat4],
    out: &mut [LocalVertex],
) {
    for (((v, j), w), o) in bind.iter().zip(joints).zip(weights).zip(out.iter_mut()) {
        if w[0] == 0.0 && w[1] == 0.0 && w[2] == 0.0 && w[3] == 0.0 {
            o.position = v.position;
            o.normal = v.normal;
            continue;
        }
        // Blend the affine 3x4 part (columns x, y, z, translation)
        let (mut cx, mut cy, mut cz, mut ct) = (Vec4::ZERO, Vec4::ZERO, Vec4::ZERO, Vec4::ZERO);
        for k in 0..SKIN_INFLUENCES {
            let wk = w[k];
            if wk == 0.0 {
                continue;
            }
            let m = &palette[j[k] as usize];
            cx += m.x_axis * wk;
            cy += m.y_axis * wk;
            cz += m.z_axis * wk;
            ct += m.w_axis * wk;
        }
        let p = v.position;
        o.position = (cx * p.x + cy * p.y + cz * p.z + ct).truncate();
        let (a, b, c) = (cx.truncate(), cy.truncate(), cz.truncate());
        // Cofactor matrix columns: (b x c, c x a, a x b); sign keeps mirrored joints outward
        let cof = Mat3::from_cols(b.cross(c), c.cross(a), a.cross(b));
        let det = a.dot(b.cross(c));
        let n = cof * v.normal * det.signum();
        let len = n.length();
        o.normal = if len > 1e-20 && len.is_finite() {
            n / len
        } else {
            v.normal
        };
    }
}

/// Max |coordinate| per axis of the finite positions (at least 0.1, like custom meshes).
fn posed_half_extents(vertices: &[LocalVertex]) -> Vec3 {
    let mut max_abs = Vec3::splat(0.1);
    for v in vertices {
        if v.position.is_finite() {
            max_abs = max_abs.max(v.position.abs());
        }
    }
    max_abs
}
