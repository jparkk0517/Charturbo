//! Extra point lights (`addPointLight`): up to `MAX_POINT_LIGHTS` coloured lights with a range,
//! beside the `setLighting` point light (which keeps its own attenuation and is the one point
//! shadows follow). Both shading models loop over them; with none the loop runs zero times.

use crate::renderer::{SceneLightUniformRaw, MAX_POINT_LIGHTS};
use glam::Vec3;

/// Floats per light in the packed WASM array: x, y, z, range, r, g, b, intensity.
pub const POINT_LIGHT_STRIDE: usize = 8;
pub const DEFAULT_POINT_LIGHT_RANGE: f32 = 100.0;
pub const MIN_POINT_LIGHT_RANGE: f32 = 0.01;
pub const MAX_POINT_LIGHT_RANGE: f32 = 1.0e6;
pub const MAX_POINT_LIGHT_INTENSITY: f32 = 1.0e6;
/// Largest coordinate magnitude a light position keeps (finite in the shader's squares)
const MAX_COORD: f32 = 1.0e7;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PointLight {
    pub position: Vec3,
    /// sRGB color, components in [0, 1]
    pub color: [f32; 3],
    /// Classic: scales the `setLighting` point falloff; PBR: luminous intensity of the
    /// inverse-square falloff (`intensity / (d^2 + 1)`)
    pub intensity: f32,
    /// Distance where the smooth window reaches zero (the light stops there)
    pub range: f32,
}

impl Default for PointLight {
    fn default() -> Self {
        Self {
            position: Vec3::ZERO,
            color: [1.0; 3],
            intensity: 1.0,
            range: DEFAULT_POINT_LIGHT_RANGE,
        }
    }
}

impl PointLight {
    /// Clamped copy: non-finite positions become 0, colors clamp to [0, 1] (non-finite = 1),
    /// intensity to [0, `MAX_POINT_LIGHT_INTENSITY`] (non-finite = 0) and range to
    /// [`MIN_POINT_LIGHT_RANGE`, `MAX_POINT_LIGHT_RANGE`] (non-finite = the default).
    pub fn sanitized(self) -> Self {
        let coord = |v: f32| {
            if v.is_finite() {
                v.clamp(-MAX_COORD, MAX_COORD)
            } else {
                0.0
            }
        };
        let unit = |v: f32| {
            if v.is_finite() {
                v.clamp(0.0, 1.0)
            } else {
                1.0
            }
        };
        Self {
            position: Vec3::new(
                coord(self.position.x),
                coord(self.position.y),
                coord(self.position.z),
            ),
            color: self.color.map(unit),
            intensity: if self.intensity.is_finite() {
                self.intensity.clamp(0.0, MAX_POINT_LIGHT_INTENSITY)
            } else {
                0.0
            },
            range: if self.range.is_finite() {
                self.range
                    .clamp(MIN_POINT_LIGHT_RANGE, MAX_POINT_LIGHT_RANGE)
            } else {
                DEFAULT_POINT_LIGHT_RANGE
            },
        }
    }
}

/// Lights from the packed array (`POINT_LIGHT_STRIDE` floats each; a trailing partial light
/// is ignored), sanitized and truncated to `MAX_POINT_LIGHTS`.
pub fn unpack_point_lights(data: &[f32]) -> Vec<PointLight> {
    data.chunks_exact(POINT_LIGHT_STRIDE)
        .take(MAX_POINT_LIGHTS)
        .map(|c| {
            PointLight {
                position: Vec3::new(c[0], c[1], c[2]),
                range: c[3],
                color: [c[4], c[5], c[6]],
                intensity: c[7],
            }
            .sanitized()
        })
        .collect()
}

/// Writes the lights (at most `MAX_POINT_LIGHTS`) and their count into the uniform; unused
/// slots are zeroed.
pub fn pack_point_lights(lights: &[PointLight], light: &mut SceneLightUniformRaw) {
    let n = lights.len().min(MAX_POINT_LIGHTS);
    light.point_lights = [[0.0; 4]; 2 * MAX_POINT_LIGHTS];
    for (i, l) in lights.iter().take(n).enumerate() {
        light.point_lights[2 * i] = [l.position.x, l.position.y, l.position.z, l.range];
        light.point_lights[2 * i + 1] = [l.color[0], l.color[1], l.color[2], l.intensity];
    }
    light.point_lights_count = [n as f32, 0.0, 0.0, 0.0];
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::mem::offset_of;

    #[test]
    fn uniform_layout_appends_the_lights_after_the_sh_terms() {
        assert_eq!(offset_of!(SceneLightUniformRaw, env_sh), 112);
        assert_eq!(offset_of!(SceneLightUniformRaw, point_lights_count), 256);
        assert_eq!(offset_of!(SceneLightUniformRaw, point_lights), 272);
        assert_eq!(
            std::mem::size_of::<SceneLightUniformRaw>(),
            272 + MAX_POINT_LIGHTS * 32
        );
        // Well inside WebGL2's 16 KiB minimum uniform block size
        assert!(std::mem::size_of::<SceneLightUniformRaw>() <= 16 * 1024);
    }

    #[test]
    fn sanitize_clamps_every_field() {
        let l = PointLight {
            position: Vec3::new(f32::NAN, 2.0, f32::INFINITY),
            color: [-1.0, 0.5, f32::NAN],
            intensity: -3.0,
            range: 0.0,
        }
        .sanitized();
        assert_eq!(l.position, Vec3::new(0.0, 2.0, 0.0));
        assert_eq!(l.color, [0.0, 0.5, 1.0]);
        assert_eq!(l.intensity, 0.0);
        assert_eq!(l.range, MIN_POINT_LIGHT_RANGE);
        let l = PointLight {
            intensity: f32::NAN,
            range: f32::NAN,
            ..PointLight::default()
        }
        .sanitized();
        assert_eq!((l.intensity, l.range), (0.0, DEFAULT_POINT_LIGHT_RANGE));
        let l = PointLight {
            intensity: 1e9,
            range: 1e9,
            ..PointLight::default()
        }
        .sanitized();
        assert_eq!(
            (l.intensity, l.range),
            (MAX_POINT_LIGHT_INTENSITY, MAX_POINT_LIGHT_RANGE)
        );
        assert_eq!(PointLight::default().sanitized(), PointLight::default());
    }

    #[test]
    fn unpack_reads_the_stride_and_caps_the_count() {
        let mut data = Vec::new();
        for i in 0..10 {
            data.extend_from_slice(&[i as f32, 1.0, 2.0, 50.0, 1.0, 0.0, 0.5, 3.0]);
        }
        data.push(7.0); // partial trailing light: ignored
        let lights = unpack_point_lights(&data);
        assert_eq!(lights.len(), MAX_POINT_LIGHTS);
        assert_eq!(lights[3].position, Vec3::new(3.0, 1.0, 2.0));
        assert_eq!((lights[3].range, lights[3].intensity), (50.0, 3.0));
        assert_eq!(lights[3].color, [1.0, 0.0, 0.5]);
        assert!(unpack_point_lights(&[1.0; 7]).is_empty());
    }

    #[test]
    fn scene_uniform_carries_the_lights_beside_the_legacy_one() {
        let mut scene = super::super::SceneWorld::new();
        let base = scene.light_uniform(Vec3::ZERO);
        assert_eq!(base.point_lights_count, [0.0; 4]);
        scene.point_lights = unpack_point_lights(&[5.0, 6.0, 7.0, 30.0, 0.0, 0.0, 1.0, 2.5]);
        let u = scene.light_uniform(Vec3::ZERO);
        assert_eq!(u.point_lights_count[0], 1.0);
        assert_eq!(u.point_lights[0], [5.0, 6.0, 7.0, 30.0]);
        assert_eq!(u.point_lights[1], [0.0, 0.0, 1.0, 2.5]);
        // The setLighting point light is unaffected
        assert_eq!(u.point_light_pos_intensity, base.point_light_pos_intensity);
    }

    #[test]
    fn pack_writes_pairs_and_zeroes_unused_slots() {
        let mut u = SceneLightUniformRaw::default();
        u.point_lights = [[9.0; 4]; 2 * MAX_POINT_LIGHTS];
        let lights = [
            PointLight {
                position: Vec3::new(1.0, 2.0, 3.0),
                color: [1.0, 0.0, 0.0],
                intensity: 2.0,
                range: 40.0,
            },
            PointLight {
                position: Vec3::new(-1.0, 0.0, 0.0),
                color: [0.0, 1.0, 0.0],
                intensity: 0.5,
                range: 10.0,
            },
        ];
        pack_point_lights(&lights, &mut u);
        assert_eq!(u.point_lights_count, [2.0, 0.0, 0.0, 0.0]);
        assert_eq!(u.point_lights[0], [1.0, 2.0, 3.0, 40.0]);
        assert_eq!(u.point_lights[1], [1.0, 0.0, 0.0, 2.0]);
        assert_eq!(u.point_lights[2], [-1.0, 0.0, 0.0, 10.0]);
        assert_eq!(u.point_lights[3], [0.0, 1.0, 0.0, 0.5]);
        assert!(u.point_lights[4..].iter().all(|v| *v == [0.0; 4]));
        // Over the limit: only the first MAX_POINT_LIGHTS are packed
        pack_point_lights(&[PointLight::default(); 12], &mut u);
        assert_eq!(u.point_lights_count[0], MAX_POINT_LIGHTS as f32);
        // None: the default uniform (zero count) exactly
        pack_point_lights(&[], &mut u);
        assert_eq!(u.point_lights_count, [0.0; 4]);
        assert_eq!(u.point_lights, SceneLightUniformRaw::default().point_lights);
    }
}
