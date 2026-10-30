//! Opt-in HDR post-processing of the PBR scene meshes: bloom and auto exposure (eye
//! adaptation). Off by default; applies only with the PBR shading model on devices that render
//! `Rgba16Float` (see `renderer::post`).

use super::{ShadingConfig, ShadingModel};
use crate::renderer::{AutoExposureParams, BloomParams, PostFrame};

pub const MAX_BLOOM_INTENSITY: f32 = 8.0;
pub const MAX_BLOOM_THRESHOLD: f32 = 64.0;
/// EV bounds of the auto exposure clamp and of the compensation
pub const MAX_EV: f32 = 16.0;
pub const MAX_EV_COMPENSATION: f32 = 8.0;
pub const MAX_ADAPTATION_SPEED: f32 = 100.0;
/// Longest frame step the adaptation takes (a page resumed after a pause snaps at most this far)
pub const MAX_ADAPTATION_DT: f32 = 10.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BloomConfig {
    pub enabled: bool,
    /// Bloom added to the exposed scene (0..8)
    pub intensity: f32,
    /// Exposed linear brightness where the glow starts (0..64)
    pub threshold: f32,
    /// Soft knee as a fraction of the threshold (0 = hard cut, 1 = widest)
    pub knee: f32,
    /// Spread of the glow (0 = tight, 1 = widest)
    pub radius: f32,
}

impl Default for BloomConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            intensity: 0.6,
            threshold: 1.0,
            knee: 0.5,
            radius: 0.7,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AutoExposureConfig {
    pub enabled: bool,
    /// EV clamp of the metered exposure (EV 0 = average luminance 0.18)
    pub min_ev: f32,
    pub max_ev: f32,
    /// Adaptation speed toward a brighter / darker scene (1 / s; 0 = frozen)
    pub speed_up: f32,
    pub speed_down: f32,
    /// EV offset on top of the metered exposure (+1 = twice as bright)
    pub compensation: f32,
    /// Snap to the metered exposure every frame (else only the first frame snaps)
    pub instant: bool,
}

impl Default for AutoExposureConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            min_ev: -4.0,
            max_ev: 4.0,
            speed_up: 3.0,
            speed_down: 1.0,
            compensation: 0.0,
            instant: false,
        }
    }
}

/// Post-processing settings (`SceneWorld::post`).
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct PostProcessConfig {
    pub bloom: BloomConfig,
    pub auto_exposure: AutoExposureConfig,
}

fn finite_or(v: f32, fallback: f32) -> f32 {
    if v.is_finite() {
        v
    } else {
        fallback
    }
}

impl PostProcessConfig {
    /// Clamps every field into its valid range (non-finite values take the defaults; an
    /// inverted EV range collapses to the min).
    pub fn sanitized(self) -> Self {
        let (b, db) = (self.bloom, BloomConfig::default());
        let (a, da) = (self.auto_exposure, AutoExposureConfig::default());
        let min_ev = finite_or(a.min_ev, da.min_ev).clamp(-MAX_EV, MAX_EV);
        let max_ev = finite_or(a.max_ev, da.max_ev)
            .clamp(-MAX_EV, MAX_EV)
            .max(min_ev);
        let speed = |v: f32, d: f32| finite_or(v, d).clamp(0.0, MAX_ADAPTATION_SPEED);
        Self {
            bloom: BloomConfig {
                enabled: b.enabled,
                intensity: finite_or(b.intensity, db.intensity).clamp(0.0, MAX_BLOOM_INTENSITY),
                threshold: finite_or(b.threshold, db.threshold).clamp(0.0, MAX_BLOOM_THRESHOLD),
                knee: finite_or(b.knee, db.knee).clamp(0.0, 1.0),
                radius: finite_or(b.radius, db.radius).clamp(0.0, 1.0),
            },
            auto_exposure: AutoExposureConfig {
                enabled: a.enabled,
                min_ev,
                max_ev,
                speed_up: speed(a.speed_up, da.speed_up),
                speed_down: speed(a.speed_down, da.speed_down),
                compensation: finite_or(a.compensation, da.compensation)
                    .clamp(-MAX_EV_COMPENSATION, MAX_EV_COMPENSATION),
                instant: a.instant,
            },
        }
    }

    /// Bloom or auto exposure is on.
    pub fn any_enabled(&self) -> bool {
        self.bloom.enabled || self.auto_exposure.enabled
    }

    /// The frame's post parameters, or `None` when off or the shading model is classic (its
    /// gamma-space look is display referred).
    pub fn frame(&self, shading: &ShadingConfig, dt: f32) -> Option<PostFrame> {
        if !self.any_enabled() || shading.model != ShadingModel::Pbr {
            return None;
        }
        let (b, a) = (self.bloom, self.auto_exposure);
        Some(PostFrame {
            exposure: shading.exposure,
            tone_mapping: shading.tone_mapping.code(),
            dt: finite_or(dt, 0.0).clamp(0.0, MAX_ADAPTATION_DT),
            bloom: b.enabled.then_some(BloomParams {
                intensity: b.intensity,
                threshold: b.threshold,
                knee: b.knee,
                radius: b.radius,
            }),
            auto_exposure: a.enabled.then_some(AutoExposureParams {
                min_ev: a.min_ev,
                max_ev: a.max_ev,
                speed_up: a.speed_up,
                speed_down: a.speed_down,
                compensation: a.compensation,
                instant: a.instant,
            }),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_off() {
        let c = PostProcessConfig::default();
        assert!(!c.any_enabled());
        assert_eq!(c.sanitized(), c);
        let pbr = ShadingConfig {
            model: ShadingModel::Pbr,
            ..ShadingConfig::default()
        };
        assert_eq!(c.frame(&pbr, 0.016), None);
    }

    #[test]
    fn sanitize_clamps_and_replaces_non_finite() {
        let c = PostProcessConfig {
            bloom: BloomConfig {
                enabled: true,
                intensity: 100.0,
                threshold: -1.0,
                knee: f32::NAN,
                radius: 2.0,
            },
            auto_exposure: AutoExposureConfig {
                enabled: true,
                min_ev: 3.0,
                max_ev: -30.0,
                speed_up: f32::INFINITY,
                speed_down: -1.0,
                compensation: 99.0,
                instant: true,
            },
        }
        .sanitized();
        assert_eq!(
            c.bloom,
            BloomConfig {
                enabled: true,
                intensity: MAX_BLOOM_INTENSITY,
                threshold: 0.0,
                knee: 0.5,
                radius: 1.0
            }
        );
        let a = c.auto_exposure;
        assert_eq!(
            (a.min_ev, a.max_ev),
            (3.0, 3.0),
            "inverted range collapses to min"
        );
        assert_eq!((a.speed_up, a.speed_down), (3.0, 0.0));
        assert_eq!(a.compensation, MAX_EV_COMPENSATION);
        assert!(a.instant);
    }

    #[test]
    fn frame_needs_pbr_and_carries_shading() {
        let c = PostProcessConfig {
            bloom: BloomConfig {
                enabled: true,
                ..Default::default()
            },
            ..Default::default()
        };
        assert_eq!(
            c.frame(&ShadingConfig::default(), 0.016),
            None,
            "classic shading"
        );
        let shading = ShadingConfig {
            model: ShadingModel::Pbr,
            exposure: 2.0,
            ..ShadingConfig::default()
        };
        let f = c.frame(&shading, 99.0).unwrap();
        assert_eq!(
            (f.exposure, f.tone_mapping, f.dt),
            (2.0, 1, MAX_ADAPTATION_DT)
        );
        assert_eq!(f.bloom.unwrap().threshold, 1.0);
        assert!(f.auto_exposure.is_none());
        assert_eq!(c.frame(&shading, f32::NAN).unwrap().dt, 0.0);
    }
}
