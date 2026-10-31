//! WASM binding of CPU-skinned custom meshes (glTF skins), kept apart from `lib.rs`.

use crate::WasmCharturboEngine;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl WasmCharturboEngine {
    /// Makes a custom mesh skinned: 4 joint indices (`joints`) and weights per vertex, driven by
    /// `joint_count` joint matrices (bind pose until `set_object_joint_matrices`). Weights are
    /// normalized. Empty arrays remove the skin. `false` when the object is missing or not a
    /// custom mesh; throws on mismatched lengths or out-of-range joint indices.
    pub fn set_object_skin(
        &mut self,
        object_id: u32,
        joints: &[u16],
        weights: &[f32],
        joint_count: u32,
    ) -> Result<bool, JsValue> {
        self.inner
            .scene_mut()
            .set_object_skin(object_id, joints, weights, joint_count)
            .map_err(JsValue::from_str)
    }

    /// Re-skins many objects in one call: object `k` takes `counts[k]` joint matrices (16
    /// column-major floats each, object space) from `matrices`, in order. Objects whose count
    /// differs from their joint count (or that are unknown / unskinned) are skipped. Returns the
    /// number of re-skinned objects.
    pub fn set_object_joint_matrices(&mut self, ids: &[u32], counts: &[u32], matrices: &[f32]) -> u32 {
        self.inner
            .scene_mut()
            .set_object_joint_matrices(ids, counts, matrices) as u32
    }

    /// Posed positions + normals (6 floats per vertex, object space) of a skinned object; empty
    /// when it is missing or not skinned.
    pub fn get_object_skinned_vertices(&self, object_id: u32) -> Vec<f32> {
        self.inner.scene().skinned_vertices(object_id).unwrap_or_default()
    }
}
