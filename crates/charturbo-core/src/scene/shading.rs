//! Scene mesh shading model: the default Blinn-Phong "classic" look, or opt-in physically based
//! shading (metallic-roughness GGX, environment lighting, exposure + tone mapping). Colors are
//! given in sRGB like every other scene color; the PBR shader lights in linear space.

use crate::renderer::SceneLightUniformRaw;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ShadingModel {
    /// Blinn-Phong in gamma space (the default; chart / scientific 3D looks never change)
    #[default]
    Classic,
    /// Metallic-roughness PBR in linear space, tone mapped and sRGB encoded in the shader
    Pbr,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ToneMapping {
    /// Linear -> clamp
    None,
    /// ACES filmic fit (Narkowicz 2015)
    #[default]
    Aces,
    /// `x / (1 + x)`
    Reinhard,
}

impl ToneMapping {
    pub fn from_code(code: u32) -> Self {
        match code {
            0 => Self::None,
            2 => Self::Reinhard,
            _ => Self::Aces,
        }
    }

    pub fn code(self) -> u32 {
        match self {
            Self::None => 0,
            Self::Aces => 1,
            Self::Reinhard => 2,
        }
    }
}

/// Shading settings of the scene meshes (`SceneWorld::shading`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ShadingConfig {
    pub model: ShadingModel,
    pub tone_mapping: ToneMapping,
    /// Linear multiplier applied before tone mapping
    pub exposure: f32,
    /// Hemisphere environment (sRGB): sky = +y, ground = -y. Used when there is no env map.
    pub env_sky: [f32; 3],
    pub env_ground: [f32; 3],
    /// Scales the environment (hemisphere or map) radiance
    pub env_intensity: f32,
    /// Equirectangular environment texture id (0 = none; unknown ids fall back to the hemisphere)
    pub env_map: u32,
}

impl Default for ShadingConfig {
    fn default() -> Self {
        Self {
            model: ShadingModel::Classic,
            tone_mapping: ToneMapping::Aces,
            exposure: 1.0,
            env_sky: DEFAULT_ENV_SKY,
            env_ground: DEFAULT_ENV_GROUND,
            env_intensity: 1.0,
            env_map: 0,
        }
    }
}

pub const DEFAULT_ENV_SKY: [f32; 3] = [0.6, 0.66, 0.76];
pub const DEFAULT_ENV_GROUND: [f32; 3] = [0.24, 0.22, 0.2];
pub const MAX_EXPOSURE: f32 = 16.0;
pub const MAX_ENV_INTENSITY: f32 = 16.0;

/// Exact piecewise sRGB -> linear transfer (IEC 61966-2-1).
pub fn srgb_to_linear(c: f32) -> f32 {
    let c = c.clamp(0.0, 1.0);
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

fn finite_or(v: f32, fallback: f32) -> f32 {
    if v.is_finite() {
        v
    } else {
        fallback
    }
}

fn color_or(c: [f32; 3], fallback: [f32; 3]) -> [f32; 3] {
    [0, 1, 2].map(|i| finite_or(c[i], fallback[i]).clamp(0.0, 1.0))
}

impl ShadingConfig {
    /// Clamps every field into its valid range (non-finite values take the defaults).
    pub fn sanitized(self) -> Self {
        let d = Self::default();
        Self {
            model: self.model,
            tone_mapping: self.tone_mapping,
            exposure: finite_or(self.exposure, d.exposure).clamp(0.0, MAX_EXPOSURE),
            env_sky: color_or(self.env_sky, d.env_sky),
            env_ground: color_or(self.env_ground, d.env_ground),
            env_intensity: finite_or(self.env_intensity, d.env_intensity)
                .clamp(0.0, MAX_ENV_INTENSITY),
            env_map: self.env_map,
        }
    }

    /// Writes the shading fields of the light uniform. The environment mip count (`env_sky.w`)
    /// and the output sRGB encode flag (`env_ground.w`) are left 0: the render backend fills
    /// them in from its texture registry and surface format.
    pub fn pack(&self, light: &mut SceneLightUniformRaw) {
        let lin = |c: [f32; 3]| c.map(srgb_to_linear);
        let (sky, ground) = (lin(self.env_sky), lin(self.env_ground));
        light.shading = [
            if self.model == ShadingModel::Pbr {
                1.0
            } else {
                0.0
            },
            self.tone_mapping.code() as f32,
            self.exposure,
            self.env_intensity,
        ];
        light.env_sky = [sky[0], sky[1], sky[2], 0.0];
        light.env_ground = [ground[0], ground[1], ground[2], 0.0];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn srgb_decode_is_the_exact_piecewise_curve() {
        assert_eq!(srgb_to_linear(0.0), 0.0);
        assert_eq!(srgb_to_linear(1.0), 1.0);
        assert!((srgb_to_linear(0.04045) - 0.04045 / 12.92).abs() < 1e-7);
        assert!((srgb_to_linear(0.5) - 0.214_041_14).abs() < 1e-6);
        assert_eq!(srgb_to_linear(2.0), 1.0);
        assert_eq!(srgb_to_linear(-1.0), 0.0);
    }

    #[test]
    fn pack_writes_linear_environment_and_codes() {
        let mut light = SceneLightUniformRaw::default();
        assert_eq!(light.shading[0], 0.0, "classic by default");
        let cfg = ShadingConfig {
            model: ShadingModel::Pbr,
            tone_mapping: ToneMapping::Reinhard,
            exposure: 1.5,
            env_sky: [1.0, 0.5, 0.0],
            env_ground: [0.0, 0.0, 1.0],
            env_intensity: 2.0,
            env_map: 7,
        };
        cfg.pack(&mut light);
        assert_eq!(light.shading, [1.0, 2.0, 1.5, 2.0]);
        assert_eq!(light.env_sky[0], 1.0);
        assert!((light.env_sky[1] - 0.214_041_14).abs() < 1e-6);
        assert_eq!(light.env_sky[3], 0.0, "mip count is the backend's");
        assert_eq!(light.env_ground, [0.0, 0.0, 1.0, 0.0]);
    }

    #[test]
    fn sanitized_clamps_and_replaces_non_finite_values() {
        let cfg = ShadingConfig {
            exposure: f32::NAN,
            env_intensity: 99.0,
            env_sky: [2.0, -1.0, f32::INFINITY],
            ..ShadingConfig::default()
        }
        .sanitized();
        assert_eq!(cfg.exposure, 1.0);
        assert_eq!(cfg.env_intensity, MAX_ENV_INTENSITY);
        assert_eq!(cfg.env_sky, [1.0, 0.0, DEFAULT_ENV_SKY[2]]);
        assert_eq!(ToneMapping::from_code(0), ToneMapping::None);
        assert_eq!(ToneMapping::from_code(9), ToneMapping::Aces);
        assert_eq!(ToneMapping::Reinhard.code(), 2);
    }
}
