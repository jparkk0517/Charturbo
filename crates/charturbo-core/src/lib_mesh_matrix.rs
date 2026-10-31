//! WASM binding of per-object mesh matrices (animated glTF node chains), kept apart from `lib.rs`.

use crate::WasmCharturboEngine;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl WasmCharturboEngine {
    /// Sets the mesh matrices of many objects in one call: 16 column-major floats per id, applied
    /// to the vertices before the object transform (world = parents * TRS * mesh matrix; children
    /// do not inherit it). Identity / non-finite clears it. Returns the number of known ids.
    pub fn set_object_mesh_matrices(&mut self, ids: &[u32], matrices: &[f32]) -> u32 {
        self.inner
            .scene_mut()
            .set_object_mesh_matrices(ids, matrices) as u32
    }

    /// The object's mesh matrix (16 column-major floats), or empty when it has none / is unknown.
    pub fn get_object_mesh_matrix(&self, object_id: u32) -> Vec<f32> {
        self.inner
            .scene()
            .find_object(object_id)
            .and_then(|o| o.transform.mesh_matrix)
            .map(|m| m.to_cols_array().to_vec())
            .unwrap_or_default()
    }
}
