//! WASM binding of the orbit camera pose (kept apart from `lib.rs`): the SDK's `getCameraState`,
//! wheel zoom / pan gains and `focusNode` distance read it.

use crate::WasmVizEngine;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl WasmVizEngine {
    /// `[target_x, target_y, target_z, distance, yaw, pitch, fov_y, aspect]` (radians).
    pub fn camera_state(&self) -> Vec<f32> {
        let c = self.inner.camera();
        let t = c.target();
        vec![t.x, t.y, t.z, c.distance(), c.yaw(), c.pitch(), c.fov_y(), c.aspect()]
    }
}
