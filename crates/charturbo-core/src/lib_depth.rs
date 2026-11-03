//! WASM binding of the depth output pass (AI video conditioning, renderer/depth_out.rs), kept
//! apart from `lib.rs`.

use crate::renderer::depth_out::{DepthEncoding, DepthOutput};
use crate::WasmCharturboEngine;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl WasmCharturboEngine {
    /// Turns the depth output on: every frame is replaced by the encoded planar view depth.
    /// `encoding` 0 = inverse, 1 = linear (both need finite `0 < near < far`, engine units),
    /// 2 = packed (24-bit `D / F`; `near` / `far` ignored). Throws on an invalid setting and
    /// while MSAA is on (`set_antialias(1)` first: WebGL2 cannot sample a multisampled depth
    /// buffer); the previous setting is then kept.
    pub fn set_depth_output(&mut self, encoding: u32, near: f32, far: f32) -> Result<(), JsValue> {
        let encoding = DepthEncoding::from_code(encoding)
            .ok_or_else(|| JsValue::from_str(&format!("depth output: unknown encoding code {encoding}")))?;
        let output = DepthOutput::new(encoding, near, far).map_err(|e| JsValue::from_str(&e))?;
        self.inner
            .set_depth_output(Some(output))
            .map_err(|e| JsValue::from_str(&e))
    }

    /// Back to beauty frames.
    pub fn clear_depth_output(&mut self) {
        let _ = self.inner.set_depth_output(None);
    }

    /// `[on 1/0, encoding code, near, far]` (`[0, 0, 0, 0]` when off).
    pub fn get_depth_output(&self) -> Vec<f32> {
        match self.inner.depth_output() {
            Some(o) => vec![1.0, o.encoding.code() as f32, o.near, o.far],
            None => vec![0.0; 4],
        }
    }

    /// `[near, far, orthographic 1/0]` clip planes of the current projection (engine units):
    /// `packed` decodes as `D = q / (2^24 - 1) * far`.
    pub fn get_depth_clip_planes(&self) -> Vec<f32> {
        let (n, f, ortho) = self.inner.depth_clip_planes();
        vec![n, f, if ortho { 1.0 } else { 0.0 }]
    }
}
