//! WASM binding of the main-pass multisample anti-aliasing switch, kept apart from `lib.rs`.

use crate::WasmCharturboEngine;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl WasmCharturboEngine {
    /// `samples` 4 = MSAA x4, anything else = off. Returns the applied count: 1 when the
    /// device cannot render the surface format x4.
    pub fn set_antialias(&mut self, samples: u32) -> u32 {
        self.inner.set_antialias(samples)
    }

    /// Applied main-pass sample count (1 = off).
    pub fn get_antialias(&self) -> u32 {
        self.inner.antialias()
    }
}
