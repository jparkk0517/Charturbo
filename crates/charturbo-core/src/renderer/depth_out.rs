//! Depth output pass (AI video conditioning): one fullscreen fragment pass after the main pass
//! reads the frame's reverse-Z `Depth32Float` buffer texel by texel (NEAREST sampler at pixel
//! centers, see `DEPTH_OUT_WGSL` for why not `textureLoad`) and replaces the frame
//! with an encoding of the planar view depth `D` (distance along the view axis, engine units):
//!
//! ```text
//! z = depth buffer value (reverse-Z: 1 at the near plane N, 0 at the far plane F / cleared)
//! D = N F / (N + z (F - N))        perspective
//!   = F - z (F - N)                orthographic
//! inverse: v = clamp((1/D - 1/Dfar) / (1/Dnear - 1/Dfar), 0, 1)   (near = white)
//! linear:  v = clamp((Dfar - D) / (Dfar - Dnear), 0, 1)           (near = white)
//! byte = floor(255 v + 0.5), RGBA = (byte, byte, byte, 255); background (z == 0) -> 0
//! packed:  q = round(clamp(D / F, 0, 1) (2^24 - 1)), R = q >> 16, G = (q >> 8) & 255,
//!          B = q & 255; background (z == 0) -> q = 2^24 - 1 (measurement of Dnear / Dfar)
//! ```
//!
//! With the perspective projection `1/D = 1/F + z (1/N - 1/F)`, so `inverse` is affine in `z`
//! (coefficients computed here in f64, no linearization in the shader). `[Dnear, Dfar]` is
//! supplied by the caller. N / F / ortho are the camera's clip planes of the frame.
//!
//! This module holds the backend-independent parts: settings, the uniform packing, the WGSL and
//! a pure-Rust mirror of the shader (`encode_f32`) for tests and CPU-side decoding.

use bytemuck::{Pod, Zeroable};

/// Largest packed depth code (24 bits): the background / far plane.
pub const PACKED_MAX: u32 = (1 << 24) - 1;

/// Encoding of the depth output.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DepthEncoding {
    /// Normalized inverse depth (disparity), near = white
    Inverse,
    /// Inverted normalized linear depth, near = white
    Linear,
    /// 24-bit `D / F` in RGB (measurement)
    Packed,
}

impl DepthEncoding {
    /// Wire code (0 inverse, 1 linear, 2 packed).
    pub fn code(self) -> u32 {
        match self {
            Self::Inverse => 0,
            Self::Linear => 1,
            Self::Packed => 2,
        }
    }

    pub fn from_code(code: u32) -> Option<Self> {
        match code {
            0 => Some(Self::Inverse),
            1 => Some(Self::Linear),
            2 => Some(Self::Packed),
            _ => None,
        }
    }
}

/// Depth output setting: encoding + normalization range `[near, far]` (engine units; only
/// `inverse` / `linear` use it).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DepthOutput {
    pub encoding: DepthEncoding,
    pub near: f32,
    pub far: f32,
}

impl DepthOutput {
    /// Validated setting: `inverse` / `linear` need finite `0 < near < far`; `packed` ignores
    /// the range (kept as given when valid, else 0 / 0).
    pub fn new(encoding: DepthEncoding, near: f32, far: f32) -> Result<Self, String> {
        let valid = near.is_finite() && far.is_finite() && near > 0.0 && near < far;
        match encoding {
            DepthEncoding::Packed if !valid => Ok(Self { encoding, near: 0.0, far: 0.0 }),
            DepthEncoding::Packed => Ok(Self { encoding, near, far }),
            _ if valid => Ok(Self { encoding, near, far }),
            _ => Err(format!(
                "depth output: near / far must be finite with 0 < near < far (got near {near}, far {far})"
            )),
        }
    }
}

/// One frame of the depth output: the setting + the camera's clip planes and projection.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DepthOutFrame {
    pub output: DepthOutput,
    /// Near / far clip planes of the frame's projection (engine units)
    pub z_near: f32,
    pub z_far: f32,
    pub ortho: bool,
}

/// Depth output uniform (48 bytes), group 0 binding 0.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Pod, Zeroable, Default)]
pub struct DepthOutUniformRaw {
    /// (F, (F - N) / N, (F - N) / F, 0): `D / F = 1 / (1 + z y)` (perspective) or `1 - z z'`
    pub planes: [f32; 4],
    /// (a, b, mode code, ortho 1/0): `v = a x + b` with x = z (perspective inverse), 1 / D
    /// (orthographic inverse) or D (linear); unused by `packed`
    pub map: [f32; 4],
    /// (sRGB surface 1/0: the shader outputs the linear value the surface encodes back, 0, 0, 0)
    pub misc: [f32; 4],
}

impl DepthOutUniformRaw {
    /// Uniform of a frame; `srgb_surface`: the frame's format sRGB-encodes on store.
    pub fn pack(frame: &DepthOutFrame, srgb_surface: bool) -> Self {
        let (n, f) = (frame.z_near as f64, frame.z_far as f64);
        let (dn, df) = (frame.output.near as f64, frame.output.far as f64);
        let (a, b) = match frame.output.encoding {
            DepthEncoding::Inverse => {
                let s = 1.0 / dn - 1.0 / df;
                if frame.ortho {
                    (1.0 / s, -(1.0 / df) / s)
                } else {
                    ((1.0 / n - 1.0 / f) / s, (1.0 / f - 1.0 / df) / s)
                }
            }
            DepthEncoding::Linear => (-1.0 / (df - dn), df / (df - dn)),
            DepthEncoding::Packed => (0.0, 0.0),
        };
        Self {
            planes: [f as f32, ((f - n) / n) as f32, ((f - n) / f) as f32, 0.0],
            map: [
                a as f32,
                b as f32,
                frame.output.encoding.code() as f32,
                if frame.ortho { 1.0 } else { 0.0 },
            ],
            misc: [if srgb_surface { 1.0 } else { 0.0 }, 0.0, 0.0, 0.0],
        }
    }
}

/// `floor(255 v + 0.5)` of `v` in [0, 1].
fn byte_of(v: f32) -> u8 {
    (v.clamp(0.0, 1.0) * 255.0 + 0.5).floor() as u8
}

/// Pure-Rust mirror of `fs_depth_out` (same f32 operations, before the sRGB step): the RGB
/// bytes the pass writes for depth value `z`.
pub fn encode_f32(z: f32, u: &DepthOutUniformRaw) -> [u8; 3] {
    let ortho = u.map[3] > 0.5;
    let t = if ortho { 1.0 - z * u.planes[2] } else { 1.0 / (1.0 + z * u.planes[1]) };
    if u.map[2] > 1.5 {
        let q = if z > 0.0 { ((t.clamp(0.0, 1.0) * PACKED_MAX as f32).round() as u32).min(PACKED_MAX) } else { PACKED_MAX };
        return [(q >> 16) as u8, ((q >> 8) & 255) as u8, (q & 255) as u8];
    }
    if z <= 0.0 {
        return [0; 3];
    }
    let d = u.planes[0] * t;
    let x = if u.map[2] > 0.5 { d } else if ortho { 1.0 / d } else { z };
    let b = byte_of(u.map[0] * x + u.map[1]);
    [b; 3]
}

/// Planar depth `D` (engine units) of a packed RGB pixel; `None` for the background code.
pub fn decode_packed(rgb: [u8; 3], z_far: f32) -> Option<f64> {
    let q = (rgb[0] as u32) << 16 | (rgb[1] as u32) << 8 | rgb[2] as u32;
    (q != PACKED_MAX).then(|| q as f64 / PACKED_MAX as f64 * z_far as f64)
}

/// Closed form of the normalized value `v` (before 8-bit rounding) of planar depth `d`.
pub fn closed_form_value(encoding: DepthEncoding, d: f64, near: f64, far: f64) -> f64 {
    let v = match encoding {
        DepthEncoding::Inverse => (1.0 / d - 1.0 / far) / (1.0 / near - 1.0 / far),
        DepthEncoding::Linear => (far - d) / (far - near),
        DepthEncoding::Packed => d,
    };
    v.clamp(0.0, 1.0)
}

/// Depth output shader: fullscreen triangle (as `vs_post`) + one depth texel per pixel.
///
/// WebGL2 constraints shape the binding (both found on a real WebGL2 device / in naga 24):
/// - the depth texture is an unfilterable `texture_2d<f32>` (WebGPU allows `depth32float` as
///   `unfilterable-float`), not `texture_depth_2d`: naga 24's GLSL backend rejects `textureLoad`
///   on depth textures ("WGSL `textureLoad` from depth textures is not supported in GLSL");
/// - it is read with `textureSampleLevel` through a NEAREST sampler at the pixel center, not with
///   `textureLoad`: a GLES 3.0 depth texture with `TEXTURE_COMPARE_MODE` NONE is incomplete
///   unless its filters are NEAREST (GLES 3.0.6 section 3.8.13), and `texelFetch` without a
///   sampler object uses the texture's default LINEAR filters, so it read 0 everywhere. With the
///   sampler bound, NEAREST at `(i + 0.5) / size` returns texel `i` exactly (same value as
///   `textureLoad`); `.x` is the depth.
pub const DEPTH_OUT_WGSL: &str = r#"
struct DepthOut {
    planes: vec4<f32>,
    map: vec4<f32>,
    misc: vec4<f32>,
};

@group(0) @binding(0)
var<uniform> u: DepthOut;

@group(0) @binding(1)
var depth_tex: texture_2d<f32>;

// NEAREST, non-filtering
@group(0) @binding(2)
var depth_sampler: sampler;

@vertex
fn vs_depth_out(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
    let uv = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u));
    return vec4<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
}

fn srgb_to_linear3(c: vec3<f32>) -> vec3<f32> {
    let lo = c / 12.92;
    let hi = pow((c + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
    return select(hi, lo, c <= vec3<f32>(0.04045));
}

@fragment
fn fs_depth_out(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let size = vec2<f32>(textureDimensions(depth_tex, 0));
    let z = textureSampleLevel(depth_tex, depth_sampler, pos.xy / size, 0.0).x;
    let ortho = u.map.w > 0.5;
    // D / F
    let t = select(1.0 / (1.0 + z * u.planes.y), 1.0 - z * u.planes.z, ortho);
    var rgb: vec3<f32>;
    if (u.map.z > 1.5) {
        let code = min(u32(round(clamp(t, 0.0, 1.0) * 16777215.0)), 16777215u);
        let q = select(16777215u, code, z > 0.0);
        rgb = vec3<f32>(f32(q >> 16u), f32((q >> 8u) & 255u), f32(q & 255u)) / 255.0;
    } else {
        let d = u.planes.x * t;
        let x = select(select(z, 1.0 / d, ortho), d, u.map.z > 0.5);
        let v = clamp(u.map.x * x + u.map.y, 0.0, 1.0);
        rgb = vec3<f32>(select(0.0, floor(v * 255.0 + 0.5), z > 0.0) / 255.0);
    }
    if (u.misc.x > 0.5) {
        rgb = srgb_to_linear3(rgb);
    }
    return vec4<f32>(rgb, 1.0);
}
"#;

#[cfg(test)]
mod tests {
    use super::*;
    use glam::{Mat4, Vec4};

    /// Reverse-Z depth the GPU stores for a point at planar depth `d` (the camera's projection
    /// matrices: `perspective_rh(.., far, near)` / `orthographic_rh(.., far, near)`).
    fn z_of(d: f32, n: f32, f: f32, ortho: bool) -> f32 {
        let proj = if ortho {
            Mat4::orthographic_rh(-1.0, 1.0, -1.0, 1.0, f, n)
        } else {
            Mat4::perspective_rh(0.8, 1.0, f, n)
        };
        let clip = proj * Vec4::new(0.0, 0.0, -d, 1.0);
        clip.z / clip.w
    }

    fn frame(encoding: DepthEncoding, near: f32, far: f32, n: f32, f: f32, ortho: bool) -> DepthOutFrame {
        DepthOutFrame { output: DepthOutput::new(encoding, near, far).unwrap(), z_near: n, z_far: f, ortho }
    }

    #[test]
    fn projection_depth_matches_formula() {
        // z = N (F - D) / ((F - N) D) (perspective), (F - D) / (F - N) (orthographic)
        let (n, f) = (0.01_f64, 2000.0_f64);
        for d in [0.02, 1.0, 50.0, 100.0, 1999.0] {
            let p = z_of(d as f32, n as f32, f as f32, false) as f64;
            assert!((p - n * (f - d) / ((f - n) * d)).abs() < 1e-6 * p.max(1e-6), "{d}: {p}");
            let o = z_of(d as f32, n as f32, f as f32, true) as f64;
            assert!((o - (f - d) / (f - n)).abs() < 1e-6, "{d}: {o}");
        }
    }

    #[test]
    fn shader_mirror_matches_closed_form() {
        // Exact view near plane (0.01), orbit far (2000) and a fitted far; both projections
        for (n, f) in [(0.01_f32, 2000.0_f32), (0.01, 7000.0), (0.5, 2000.0)] {
            for ortho in [false, true] {
                for encoding in [DepthEncoding::Inverse, DepthEncoding::Linear] {
                    let (near, far) = (50.0_f32, 100.0_f32);
                    let u = DepthOutUniformRaw::pack(&frame(encoding, near, far, n, f, ortho), false);
                    let mut worst = 0.0_f64;
                    for i in 0..=2000 {
                        let d = 40.0 + 70.0 * i as f64 / 2000.0;
                        let z = z_of(d as f32, n, f, ortho);
                        let v = closed_form_value(encoding, d, near as f64, far as f64);
                        let got = encode_f32(z, &u)[0] as f64;
                        // Within the rounding of the exact value (float error far below 1/255)
                        let err = (got - v * 255.0).abs();
                        worst = worst.max(err);
                        assert!(err <= 0.5 + 0.02, "{encoding:?} ortho {ortho} N {n} F {f} D {d}: {got} vs {}", v * 255.0);
                    }
                    assert!(worst >= 0.4, "the sweep crosses byte boundaries");
                }
            }
        }
    }

    #[test]
    fn range_ends_map_to_white_and_black() {
        for ortho in [false, true] {
            for encoding in [DepthEncoding::Inverse, DepthEncoding::Linear] {
                let u = DepthOutUniformRaw::pack(&frame(encoding, 50.0, 100.0, 0.01, 2000.0, ortho), false);
                assert_eq!(encode_f32(z_of(50.0, 0.01, 2000.0, ortho), &u), [255; 3]);
                assert_eq!(encode_f32(z_of(100.0, 0.01, 2000.0, ortho), &u), [0; 3]);
                // Outside the range: clamped
                assert_eq!(encode_f32(z_of(20.0, 0.01, 2000.0, ortho), &u), [255; 3]);
                assert_eq!(encode_f32(z_of(500.0, 0.01, 2000.0, ortho), &u), [0; 3]);
                // Background (cleared depth)
                assert_eq!(encode_f32(0.0, &u), [0; 3]);
            }
        }
    }

    #[test]
    fn packed_round_trip() {
        for (n, f) in [(0.01_f32, 2000.0_f32), (0.01, 7000.0)] {
            for ortho in [false, true] {
                let u = DepthOutUniformRaw::pack(&frame(DepthEncoding::Packed, 0.0, 0.0, n, f, ortho), false);
                assert_eq!(encode_f32(0.0, &u), [255; 3], "background code 2^24 - 1");
                assert_eq!(decode_packed([255; 3], f), None);
                // One code is F / (2^24 - 1); float error of the projection adds ~1e-7 D
                let mut worst = 0.0_f64;
                for i in 0..=5000 {
                    let d = 0.05 + (f as f64 * 0.999 - 0.05) * (i as f64 / 5000.0).powi(3);
                    let z = z_of(d as f32, n, f, ortho);
                    let got = decode_packed(encode_f32(z, &u), f).unwrap();
                    let err = (got - d).abs();
                    worst = worst.max(err);
                    let tol = f as f64 / PACKED_MAX as f64 + 2e-6 * d * if ortho { f as f64 / d } else { 1.0 };
                    assert!(err <= tol, "N {n} F {f} ortho {ortho} D {d}: {got} (err {err}, tol {tol})");
                }
                println!("packed N {n} F {f} ortho {ortho}: worst |D err| {worst:.3e} units");
            }
        }
        // Codes split into bytes and back
        for q in [0u32, 1, 255, 256, 65535, 65536, 0x00ab_cdef, PACKED_MAX - 1] {
            let rgb = [(q >> 16) as u8, ((q >> 8) & 255) as u8, (q & 255) as u8];
            let d = decode_packed(rgb, 2000.0).unwrap();
            assert_eq!((d / 2000.0 * PACKED_MAX as f64).round() as u32, q);
        }
    }

    fn srgb_to_linear(c: f32) -> f32 {
        if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) }
    }

    /// The sRGB surface's store encode (IEC 61966-2-1) + unorm8 rounding, in f64.
    fn srgb_store(l: f32) -> u8 {
        let l = (l as f64).clamp(0.0, 1.0);
        let s = if l <= 0.0031308 { l * 12.92 } else { 1.055 * l.powf(1.0 / 2.4) - 0.055 };
        (s * 255.0).round() as u8
    }

    #[test]
    fn srgb_surface_keeps_all_256_codes() {
        // The shader writes srgb_to_linear(byte / 255) (f32); the surface encodes it back
        let mut worst = 0.0_f64;
        for b in 0..=255u8 {
            let l = srgb_to_linear(b as f32 / 255.0);
            assert_eq!(srgb_store(l), b, "code {b}");
            let l64 = (l as f64).clamp(0.0, 1.0);
            let s = if l64 <= 0.0031308 { l64 * 12.92 } else { 1.055 * l64.powf(1.0 / 2.4) - 0.055 };
            worst = worst.max((s * 255.0 - b as f64).abs());
        }
        // Margin to the rounding boundary (0.5): the encode tolerance of a GPU must stay below it
        assert!(worst < 0.01, "worst {worst}");
    }

    #[test]
    fn uniform_packing() {
        assert_eq!(std::mem::size_of::<DepthOutUniformRaw>(), 48);
        let f = frame(DepthEncoding::Inverse, 50.0, 100.0, 0.01, 2000.0, false);
        let u = DepthOutUniformRaw::pack(&f, true);
        assert_eq!(u.planes[0], 2000.0);
        assert!((u.planes[1] - 199_999.0).abs() < 0.1);
        assert_eq!(u.map[2..], [0.0, 0.0]);
        assert_eq!(u.misc[0], 1.0);
        let p = DepthOutUniformRaw::pack(&DepthOutFrame { ortho: true, ..frame(DepthEncoding::Packed, 0.0, 0.0, 0.01, 2000.0, false) }, false);
        assert_eq!(p.map[2..], [2.0, 1.0]);
        assert_eq!(p.misc[0], 0.0);
    }

    #[test]
    fn settings_validation() {
        assert!(DepthOutput::new(DepthEncoding::Inverse, 1.0, 2.0).is_ok());
        for (near, far) in [(0.0, 1.0), (-1.0, 1.0), (2.0, 2.0), (3.0, 2.0), (f32::NAN, 1.0), (1.0, f32::INFINITY)] {
            assert!(DepthOutput::new(DepthEncoding::Inverse, near, far).is_err(), "{near} {far}");
            assert!(DepthOutput::new(DepthEncoding::Linear, near, far).is_err(), "{near} {far}");
            let p = DepthOutput::new(DepthEncoding::Packed, near, far).unwrap();
            assert_eq!((p.near, p.far), (0.0, 0.0));
        }
        assert_eq!(DepthOutput::new(DepthEncoding::Packed, 1.0, 2.0).unwrap().far, 2.0);
        for e in [DepthEncoding::Inverse, DepthEncoding::Linear, DepthEncoding::Packed] {
            assert_eq!(DepthEncoding::from_code(e.code()), Some(e));
        }
        assert_eq!(DepthEncoding::from_code(3), None);
    }

    #[test]
    fn shader_translates_to_webgl2_glsl() {
        use naga::back::glsl;
        let module = naga::front::wgsl::parse_str(DEPTH_OUT_WGSL)
            .unwrap_or_else(|e| panic!("{}", e.emit_to_string(DEPTH_OUT_WGSL)));
        let info = naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::empty())
            .validate(&module)
            .unwrap_or_else(|e| panic!("{e:?}"));
        for (stage, entry) in [(naga::ShaderStage::Vertex, "vs_depth_out"), (naga::ShaderStage::Fragment, "fs_depth_out")] {
            let options = glsl::Options {
                version: glsl::Version::Embedded { version: 300, is_webgl: true },
                ..Default::default()
            };
            let pipeline = glsl::PipelineOptions { shader_stage: stage, entry_point: entry.into(), multiview: None };
            let mut out = String::new();
            glsl::Writer::new(&mut out, &module, &info, &options, &pipeline, naga::proc::BoundsCheckPolicies::default())
                .and_then(|mut w| w.write())
                .unwrap_or_else(|e| panic!("{entry}: {e:?}"));
            assert!(out.contains("#version 300 es"));
            if entry == "fs_depth_out" {
                assert!(out.contains("textureLod"), "{out}");
            }
        }
    }
}
