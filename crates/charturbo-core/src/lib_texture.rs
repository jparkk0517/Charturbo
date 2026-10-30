//! WASM binding of the 3D scene textures (kept apart from `lib.rs`): texture creation from
//! decoded images / RGBA8 data, disposal, per-object maps and custom mesh uvs.

use crate::scene::{MaterialMaps, TextureMap};
use crate::WasmCharturboEngine;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl WasmCharturboEngine {
    /// Largest accepted texture edge in px (min of the device limit and 4096).
    pub fn max_texture_size(&self) -> u32 {
        self.inner.max_texture_size()
    }

    /// Uploads a decoded image (full size, not premultiplied, top row first); returns the id.
    pub fn create_texture_from_bitmap(
        &mut self,
        bitmap: &web_sys::ImageBitmap,
        mipmaps: bool,
    ) -> Result<u32, JsValue> {
        self.inner
            .create_texture_from_bitmap(bitmap, mipmaps)
            .map_err(|e| JsValue::from_str(&e))
    }

    /// Uploads `width * height` RGBA8 texels (top row first); returns the id.
    pub fn create_texture_rgba8(
        &mut self,
        width: u32,
        height: u32,
        rgba: &[u8],
        mipmaps: bool,
    ) -> Result<u32, JsValue> {
        self.inner
            .create_texture_rgba8(width, height, rgba, mipmaps)
            .map_err(|e| JsValue::from_str(&e))
    }

    /// HDR environment map from Radiance `.hdr` bytes (RGBE, flat or RLE): returns
    /// `[id, width, height]`. Usable as the shading `env_map`; freed by `dispose_texture`.
    pub fn create_environment_hdr(&mut self, bytes: &[u8]) -> Result<Vec<u32>, JsValue> {
        self.inner
            .create_environment_hdr(bytes)
            .map(|(id, w, h)| vec![id, w, h])
            .map_err(|e| JsValue::from_str(&e))
    }

    /// HDR environment map from `width * height` linear RGB floats (equirect, top row = +y).
    pub fn create_environment_from_float(
        &mut self,
        width: u32,
        height: u32,
        rgb: &[f32],
    ) -> Result<u32, JsValue> {
        self.inner
            .create_environment_rgb(width, height, rgb)
            .map_err(|e| JsValue::from_str(&e))
    }

    /// Resolves once the GPU work of environment map `texture_id` is known to be valid; rejects
    /// with the GPU error message otherwise (the map is not disposed here). Browser WebGPU
    /// reports such errors after `create_environment_*` returned; elsewhere they make the
    /// creation fail, so this resolves immediately. Each pending check is handed out once.
    pub fn environment_ready(&mut self, texture_id: u32) -> js_sys::Promise {
        match self.inner.take_environment_check(texture_id) {
            None => js_sys::Promise::resolve(&JsValue::UNDEFINED),
            Some(check) => wasm_bindgen_futures::future_to_promise(async move {
                match check.await {
                    None => Ok(JsValue::UNDEFINED),
                    Some(e) => Err(js_sys::Error::new(&e).into()),
                }
            }),
        }
    }

    /// Frees a texture; objects using it fall back to no map. `false` for unknown ids.
    pub fn dispose_texture(&mut self, texture_id: u32) -> bool {
        self.inner.dispose_texture(texture_id)
    }

    pub fn texture_count(&self) -> u32 {
        self.inner.texture_count()
    }

    /// Bytes held by live textures (all mip levels).
    pub fn texture_bytes(&self) -> f64 {
        self.inner.texture_bytes() as f64
    }

    /// Sets an object's base-color map: `texture_id` 0 = none, uv' = uv * repeat + offset,
    /// fragments with alpha below `alpha_test` are discarded.
    #[allow(clippy::too_many_arguments)]
    pub fn set_object_map(
        &mut self,
        object_id: u32,
        texture_id: u32,
        repeat_u: f32,
        repeat_v: f32,
        offset_u: f32,
        offset_v: f32,
        alpha_test: f32,
    ) -> bool {
        self.inner.set_object_map(
            object_id,
            TextureMap {
                texture: texture_id,
                repeat: [repeat_u, repeat_v],
                offset: [offset_u, offset_v],
                alpha_test,
            },
        )
    }

    /// `[texture_id, repeat_u, repeat_v, offset_u, offset_v, alpha_test]`, or `[]` when the
    /// object does not exist.
    pub fn get_object_map(&self, object_id: u32) -> Vec<f32> {
        self.inner.object_map(object_id).map_or_else(Vec::new, |m| {
            vec![
                m.texture as f32,
                m.repeat[0],
                m.repeat[1],
                m.offset[0],
                m.offset[1],
                m.alpha_test,
            ]
        })
    }

    /// Sets an object's PBR material maps (PBR shading only; texture ids 0 = none, sampled with
    /// the base map's uv transform): metallic-roughness (B metal, G rough, multiplying the
    /// factors), tangent-space normal map scaled by `normal_scale`, occlusion (R) with
    /// `occlusion_strength`, emissive texture (sRGB) times the linear `emissive_*` color.
    #[allow(clippy::too_many_arguments)]
    pub fn set_object_material_maps(
        &mut self,
        object_id: u32,
        metal_rough_id: u32,
        normal_id: u32,
        normal_scale: f32,
        occlusion_id: u32,
        occlusion_strength: f32,
        emissive_id: u32,
        emissive_r: f32,
        emissive_g: f32,
        emissive_b: f32,
    ) -> bool {
        self.inner.set_object_material_maps(
            object_id,
            MaterialMaps {
                metal_rough: metal_rough_id,
                normal: normal_id,
                normal_scale,
                occlusion: occlusion_id,
                occlusion_strength,
                emissive: emissive_id,
                emissive_color: [emissive_r, emissive_g, emissive_b],
            },
        )
    }

    /// `[metal_rough_id, normal_id, normal_scale, occlusion_id, occlusion_strength,
    /// emissive_id, emissive_r, emissive_g, emissive_b]`, or `[]` for an unknown object.
    pub fn get_object_material_maps(&self, object_id: u32) -> Vec<f32> {
        self.inner.object_material_maps(object_id).map_or_else(Vec::new, |m| {
            let [r, g, b] = m.emissive_color;
            vec![
                m.metal_rough as f32,
                m.normal as f32,
                m.normal_scale,
                m.occlusion as f32,
                m.occlusion_strength,
                m.emissive as f32,
                r,
                g,
                b,
            ]
        })
    }

    /// Sets a custom mesh's uvs (2 per vertex, v = 0 at the image top; empty = planar
    /// projection). `false` when the object is missing or not a custom mesh.
    pub fn set_custom_mesh_uvs(&mut self, object_id: u32, uvs: &[f32]) -> Result<bool, JsValue> {
        self.inner
            .set_custom_mesh_uvs(object_id, uvs)
            .map_err(JsValue::from_str)
    }
}
