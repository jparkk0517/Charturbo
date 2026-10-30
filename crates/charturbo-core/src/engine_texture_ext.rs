//! `VisualizationEngine` passthroughs of the scene mesh textures: the render backend owns the
//! GPU textures (ids, budget), the scene owns each object's `TextureMap`.

use super::*;
use crate::scene::TextureMap;

impl VisualizationEngine {
    /// Largest accepted texture edge (0 when the backend has no textures).
    pub fn max_texture_size(&self) -> u32 {
        self.renderer.max_texture_size()
    }

    /// New texture from tightly packed RGBA8 texels (top row first); returns its id.
    pub fn create_texture_rgba8(
        &mut self,
        width: u32,
        height: u32,
        rgba: &[u8],
        mipmaps: bool,
    ) -> Result<u32, String> {
        self.renderer
            .create_texture_rgba8(width, height, rgba, mipmaps)
    }

    /// New texture from a decoded image (browser only); returns its id.
    pub fn create_texture_from_bitmap(
        &mut self,
        bitmap: &web_sys::ImageBitmap,
        mipmaps: bool,
    ) -> Result<u32, String> {
        self.renderer.create_texture_from_bitmap(bitmap, mipmaps)
    }

    /// Frees a texture; objects mapped to it fall back to the white default (map id 0).
    pub fn dispose_texture(&mut self, texture_id: u32) -> bool {
        let disposed = self.renderer.dispose_texture(texture_id);
        if disposed {
            self.scene.clear_texture_refs(texture_id);
        }
        disposed
    }

    pub fn texture_count(&self) -> u32 {
        self.renderer.texture_count()
    }

    pub fn texture_bytes(&self) -> u64 {
        self.renderer.texture_bytes()
    }

    /// Sets an object's base-color map (`texture` 0 = none). Unknown ids render white.
    pub fn set_object_map(&mut self, object_id: u32, map: TextureMap) -> bool {
        self.scene.set_object_map(object_id, map)
    }

    pub fn object_map(&self, object_id: u32) -> Option<TextureMap> {
        self.scene.find_object(object_id).map(|o| o.map)
    }

    /// Replaces a custom mesh's uvs (2 per vertex; empty = planar projection).
    pub fn set_custom_mesh_uvs(
        &mut self,
        object_id: u32,
        uvs: &[f32],
    ) -> Result<bool, &'static str> {
        self.scene.set_custom_mesh_uvs(object_id, uvs)
    }
}
