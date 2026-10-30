//! WASM binding of the extra scene point lights (`addPointLight`), kept apart from `lib.rs`.

use crate::scene::unpack_point_lights;
use crate::WasmCharturboEngine;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl WasmCharturboEngine {
    /// Replaces the extra point lights: 8 floats each (x, y, z, range, r, g, b, intensity; sRGB
    /// color). Values are clamped (see `scene::PointLight::sanitized`); lights past
    /// `renderer::MAX_POINT_LIGHTS` and a trailing partial light are dropped.
    pub fn set_scene_point_lights(&mut self, data: &[f32]) {
        self.inner.scene_mut().point_lights = unpack_point_lights(data);
    }

    /// The applied extra point lights, packed as for `set_scene_point_lights`.
    pub fn get_scene_point_lights(&self) -> Vec<f32> {
        self.inner
            .scene()
            .point_lights
            .iter()
            .flat_map(|l| {
                [
                    l.position.x,
                    l.position.y,
                    l.position.z,
                    l.range,
                    l.color[0],
                    l.color[1],
                    l.color[2],
                    l.intensity,
                ]
            })
            .collect()
    }
}
