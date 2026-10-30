//! WASM binding of the orbit camera pose (kept apart from `lib.rs`): the SDK's `getCameraState`,
//! wheel zoom / pan gains and `focusNode` distance read it.

use crate::WasmCharturboEngine;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl WasmCharturboEngine {
    /// `[target_x, target_y, target_z, distance, yaw, pitch, fov_y, aspect, ortho_size]` (radians).
    /// ortho_size is zero in perspective mode.
    pub fn camera_state(&self) -> Vec<f32> {
        let c = self.inner.camera();
        let t = c.target();
        vec![t.x, t.y, t.z, c.distance(), c.yaw(), c.pitch(), c.fov_y(), c.aspect(), c.orthographic_size().unwrap_or(0.)]
    }

    /// Vertical field of view in degrees (clamped to 10..120; non-finite ignored).
    pub fn set_camera_fov(&mut self, degrees: f32) {
        self.inner.set_camera_fov(degrees);
    }
}
