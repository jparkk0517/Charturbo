//! Opt-in HDR post-processing of the PBR scene meshes: bloom (soft-knee threshold, 13-tap
//! downsample chain, tent upsample: Jimenez 2014) and auto exposure (log-luminance reduction to
//! 1 x 1 by fragment passes, temporal adaptation in a 1 x 1 state texture: no compute, no
//! readback). The mesh draws render linear HDR into an `Rgba16Float` target; a fullscreen
//! composite applies exposure, bloom, tone mapping and the sRGB encode into the frame before
//! the chart / graph / overlay draws. This module holds the backend-independent parts: the
//! frame parameters, the uniform packing, the mip chain / EV math and the WGSL.

use bytemuck::{Pod, Zeroable};

/// Format of the HDR scene, bloom mips and luminance / exposure textures.
pub const HDR_FORMAT_BYTES: u64 = 8;
/// Bloom mip levels at most (level 0 = half the frame).
pub const BLOOM_MAX_MIPS: usize = 6;
/// Edge of the first luminance level (64 -> 16 -> 4 -> 1 by 4 x 4 reductions).
pub const LUM_SIZE: u32 = 64;
/// Edges of the luminance reduction chain, first to last (1 x 1).
pub const LUM_CHAIN: [u32; 4] = [64, 16, 4, 1];
/// Mid grey the metered average luminance is exposed to (EV 0 = average luminance 0.18).
pub const MIDDLE_GREY: f32 = 0.18;
/// Largest value the HDR mesh shaders write (f16 max is 65504)
pub const HDR_MAX: f32 = 60000.0;

/// Bloom parameters of a frame (already sanitized).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BloomParams {
    pub intensity: f32,
    pub threshold: f32,
    /// Soft knee as a fraction of the threshold (0 = hard cut)
    pub knee: f32,
    /// Scatter of the upsample chain in [0, 1] (larger = wider glow)
    pub radius: f32,
}

/// Auto exposure parameters of a frame (already sanitized).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AutoExposureParams {
    pub min_ev: f32,
    pub max_ev: f32,
    /// Adaptation speeds (1 / s) toward a brighter (up) / darker (down) target EV
    pub speed_up: f32,
    pub speed_down: f32,
    /// Exposure compensation in EV (+1 = twice as bright)
    pub compensation: f32,
    /// Snap to the target every frame (deterministic captures)
    pub instant: bool,
}

/// One frame of enabled post-processing (`None` = off). Sent every frame after `sync_lighting`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PostFrame {
    /// Manual exposure of the shading config (linear multiplier)
    pub exposure: f32,
    /// Tone mapping code (0 none, 1 ACES, 2 Reinhard)
    pub tone_mapping: u32,
    /// Seconds since the previous frame (adaptation step; 0 = no progress)
    pub dt: f32,
    pub bloom: Option<BloomParams>,
    pub auto_exposure: Option<AutoExposureParams>,
}

/// Post uniform (80 bytes), group 0 binding 0 of every post pass.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Pod, Zeroable, Default)]
pub struct PostUniformRaw {
    /// (exposure x 2^compensation, tone mapping code, sRGB encode 1/0, bloom on 1/0)
    pub params: [f32; 4],
    /// (threshold, soft knee (absolute), intensity, scatter)
    pub bloom: [f32; 4],
    /// (min EV, max EV, blend toward a brighter target, blend toward a darker target)
    pub adapt: [f32; 4],
    /// (bloom normalisation, instant adaptation 1/0, auto exposure on 1/0, 0)
    pub misc: [f32; 4],
    /// Clear color (linear when the shader encodes sRGB) + alpha, composited under the scene
    pub clear: [f32; 4],
}

/// Bloom mip sizes: half the frame, halved per level, at most `BLOOM_MAX_MIPS` levels, stopping
/// after the first level with an edge of 2 texels or less.
pub fn bloom_mip_sizes(width: u32, height: u32) -> Vec<(u32, u32)> {
    let (mut w, mut h) = ((width / 2).max(1), (height / 2).max(1));
    let mut sizes = Vec::with_capacity(BLOOM_MAX_MIPS);
    while sizes.len() < BLOOM_MAX_MIPS {
        sizes.push((w, h));
        if w <= 2 || h <= 2 {
            break;
        }
        w = (w / 2).max(1);
        h = (h / 2).max(1);
    }
    sizes
}

/// 1 / (1 + s + s^2 + ...) over `levels` terms: the upsample chain adds level k scaled by s^k,
/// so a uniform image keeps its brightness.
pub fn bloom_norm(scatter: f32, levels: usize) -> f32 {
    let s = scatter.clamp(0.0, 1.0);
    let sum: f32 = (0..levels.max(1)).map(|k| s.powi(k as i32)).sum();
    1.0 / sum
}

/// Fraction of the remaining EV gap closed this frame: `1 - e^(-speed dt)` (0 when dt or speed is 0).
pub fn adaptation_blend(speed: f32, dt: f32) -> f32 {
    let x = (speed.max(0.0) * dt.max(0.0)).min(80.0);
    if x.is_finite() {
        1.0 - (-x).exp()
    } else {
        1.0
    }
}

/// Target EV of an average log2 luminance (the shader's math): average 0.18 = EV 0.
pub fn target_ev(avg_log2_lum: f32, min_ev: f32, max_ev: f32) -> f32 {
    (avg_log2_lum - MIDDLE_GREY.log2()).clamp(min_ev, max_ev)
}

/// One adaptation step from `prev` toward `target` (the shader's math).
pub fn adapt_ev(prev: f32, target: f32, k_up: f32, k_down: f32) -> f32 {
    let k = if target > prev { k_up } else { k_down };
    prev + (target - prev) * k
}

/// Linear exposure multiplier of an EV: `exposure * 2^compensation * 2^-ev`.
pub fn exposure_scale(exposure: f32, compensation: f32, ev: f32) -> f32 {
    exposure * (compensation - ev).exp2()
}

fn srgb_channel_to_linear(c: f32) -> f32 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

impl PostUniformRaw {
    /// Uniform of a frame: `clear` is the frame's clear color (sRGB values as given to the
    /// clear op), `encode` whether the shader sRGB-encodes (non-sRGB surface).
    pub fn pack(frame: &PostFrame, clear: [f32; 4], encode: bool, bloom_levels: usize) -> Self {
        let compensation = frame.auto_exposure.map_or(0.0, |a| a.compensation);
        let mut u = Self {
            params: [
                exposure_scale(frame.exposure, compensation, 0.0),
                frame.tone_mapping as f32,
                if encode { 1.0 } else { 0.0 },
                0.0,
            ],
            ..Default::default()
        };
        if let Some(b) = frame.bloom {
            u.params[3] = 1.0;
            u.bloom = [b.threshold, b.threshold * b.knee, b.intensity, b.radius];
            u.misc[0] = bloom_norm(b.radius, bloom_levels);
        }
        if let Some(a) = frame.auto_exposure {
            u.adapt = [
                a.min_ev,
                a.max_ev,
                adaptation_blend(a.speed_up, frame.dt),
                adaptation_blend(a.speed_down, frame.dt),
            ];
            u.misc[1] = if a.instant { 1.0 } else { 0.0 };
            u.misc[2] = 1.0;
        }
        let rgb = [clear[0], clear[1], clear[2]].map(|c| {
            let c = c.clamp(0.0, 1.0);
            if encode {
                srgb_channel_to_linear(c)
            } else {
                c
            }
        });
        u.clear = [rgb[0], rgb[1], rgb[2], clear[3].clamp(0.0, 1.0)];
        u
    }
}

/// Bytes of the frame-sized post targets: the HDR scene (+ its MSAA samples), the bloom mips.
pub fn post_target_bytes(width: u32, height: u32, samples: u32, bloom: bool) -> u64 {
    let px = width.max(1) as u64 * height.max(1) as u64;
    let msaa = if samples > 1 { px * samples as u64 } else { 0 };
    let mips: u64 = if bloom {
        bloom_mip_sizes(width, height)
            .iter()
            .map(|&(w, h)| w as u64 * h as u64)
            .sum()
    } else {
        0
    };
    (px + msaa + mips) * HDR_FORMAT_BYTES
}

/// Bytes of the auto exposure textures: the luminance chain + two 1 x 1 states.
pub fn exposure_bytes() -> u64 {
    let chain: u64 = LUM_CHAIN.iter().map(|&e| e as u64 * e as u64).sum();
    (chain + 2) * HDR_FORMAT_BYTES
}

/// Replaces the PBR mesh shader's tone map + sRGB encode with a linear HDR output (exposure,
/// tone mapping and encoding move to the composite). Applied to the PBR and shadowed PBR
/// modules; their text is otherwise unchanged.
pub fn hdr_mesh_variant(pbr_module: &str) -> String {
    const TAIL: &str = "    let mapped = clamp(tone_map(color * light.shading.z, light.shading.y), vec3<f32>(0.0), vec3<f32>(1.0));\n    let out_rgb = select(mapped, linear_to_srgb3(mapped), light.env_ground.w > 0.5);\n    return vec4<f32>(out_rgb, alpha);";
    const HDR: &str =
        "    return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(60000.0)), alpha);";
    assert_eq!(
        pbr_module.matches(TAIL).count(),
        1,
        "pbr shader output changed"
    );
    pbr_module.replacen(TAIL, HDR, 1)
}

/// Every post pass: one bind group (uniform, source texture + linear clamp sampler, the 1 x 1
/// exposure state, an auxiliary texture) and a fullscreen triangle.
pub const POST_WGSL: &str = r#"
struct PostUniform {
    // exposure x 2^compensation, tone mapping code, sRGB encode, bloom on
    params: vec4<f32>,
    // threshold, soft knee (absolute), intensity, scatter
    bloom: vec4<f32>,
    // min EV, max EV, blend toward a brighter / darker target this frame
    adapt: vec4<f32>,
    // bloom normalisation, instant adaptation, auto exposure on, 0
    misc: vec4<f32>,
    // clear color (linear when encoding) + alpha
    clear: vec4<f32>,
};

@group(0) @binding(0)
var<uniform> post: PostUniform;

@group(0) @binding(1)
var src_tex: texture_2d<f32>;

@group(0) @binding(2)
var src_sampler: sampler;

// (EV, valid) of the adapted exposure (1 x 1)
@group(0) @binding(3)
var exposure_tex: texture_2d<f32>;

// Composite: bloom mip 0; adaptation: the previous exposure state
@group(0) @binding(4)
var aux_tex: texture_2d<f32>;

struct PostOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_post(@builtin(vertex_index) vi: u32) -> PostOutput {
    let uv = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u));
    var out: PostOutput;
    out.position = vec4<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
    out.uv = uv;
    return out;
}

fn luma(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn exposure_scale() -> f32 {
    let ev = select(0.0, textureLoad(exposure_tex, vec2<i32>(0, 0), 0).x, post.misc.z > 0.5);
    return post.params.x * exp2(-ev);
}

fn src_texel() -> vec2<f32> {
    return vec2<f32>(1.0) / vec2<f32>(textureDimensions(src_tex, 0));
}

fn tap(uv: vec2<f32>, t: vec2<f32>, x: f32, y: f32) -> vec3<f32> {
    return textureSampleLevel(src_tex, src_sampler, uv + t * vec2<f32>(x, y), 0.0).rgb;
}

fn aux_tap(uv: vec2<f32>, t: vec2<f32>, x: f32, y: f32) -> vec3<f32> {
    return textureSampleLevel(aux_tex, src_sampler, uv + t * vec2<f32>(x, y), 0.0).rgb;
}

fn karis(c: vec3<f32>) -> f32 {
    return 1.0 / (1.0 + luma(c));
}

// First bloom level: exposed 13-tap downsample with a Karis average of its five boxes (no
// firefly flicker), then the soft-knee threshold
@fragment
fn fs_bloom_prefilter(in: PostOutput) -> @location(0) vec4<f32> {
    let t = src_texel();
    let uv = in.uv;
    let s = exposure_scale();
    let a = tap(uv, t, -2.0, -2.0) * s;
    let b = tap(uv, t, 0.0, -2.0) * s;
    let c = tap(uv, t, 2.0, -2.0) * s;
    let d = tap(uv, t, -2.0, 0.0) * s;
    let e = tap(uv, t, 0.0, 0.0) * s;
    let f = tap(uv, t, 2.0, 0.0) * s;
    let g = tap(uv, t, -2.0, 2.0) * s;
    let h = tap(uv, t, 0.0, 2.0) * s;
    let i = tap(uv, t, 2.0, 2.0) * s;
    let j = tap(uv, t, -1.0, -1.0) * s;
    let k = tap(uv, t, 1.0, -1.0) * s;
    let l = tap(uv, t, -1.0, 1.0) * s;
    let m = tap(uv, t, 1.0, 1.0) * s;
    let g0 = (j + k + l + m) * 0.25;
    let g1 = (a + b + d + e) * 0.25;
    let g2 = (b + c + e + f) * 0.25;
    let g3 = (d + e + g + h) * 0.25;
    let g4 = (e + f + h + i) * 0.25;
    let w0 = 0.5 * karis(g0);
    let w1 = 0.125 * karis(g1);
    let w2 = 0.125 * karis(g2);
    let w3 = 0.125 * karis(g3);
    let w4 = 0.125 * karis(g4);
    let col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
    let threshold = post.bloom.x;
    let knee = post.bloom.y;
    let br = max(col.r, max(col.g, col.b));
    var rq = clamp(br - threshold + knee, 0.0, 2.0 * knee);
    rq = rq * rq / (4.0 * knee + 1e-5);
    let contrib = max(rq, br - threshold) / max(br, 1e-5);
    return vec4<f32>(min(col * contrib, vec3<f32>(60000.0)), 1.0);
}

// Next bloom level: 13-tap downsample (Jimenez 2014)
@fragment
fn fs_bloom_down(in: PostOutput) -> @location(0) vec4<f32> {
    let t = src_texel();
    let uv = in.uv;
    let corners = tap(uv, t, -2.0, -2.0) + tap(uv, t, 2.0, -2.0) + tap(uv, t, -2.0, 2.0) + tap(uv, t, 2.0, 2.0);
    let edges = tap(uv, t, 0.0, -2.0) + tap(uv, t, -2.0, 0.0) + tap(uv, t, 2.0, 0.0) + tap(uv, t, 0.0, 2.0);
    let inner = tap(uv, t, -1.0, -1.0) + tap(uv, t, 1.0, -1.0) + tap(uv, t, -1.0, 1.0) + tap(uv, t, 1.0, 1.0);
    let col = tap(uv, t, 0.0, 0.0) * 0.125 + corners * 0.03125 + edges * 0.0625 + inner * 0.125;
    return vec4<f32>(col, 1.0);
}

// 3 x 3 tent of the smaller level, scaled by the scatter, added onto the larger level
@fragment
fn fs_bloom_up(in: PostOutput) -> @location(0) vec4<f32> {
    let t = src_texel();
    let uv = in.uv;
    let corners = tap(uv, t, -1.0, -1.0) + tap(uv, t, 1.0, -1.0) + tap(uv, t, -1.0, 1.0) + tap(uv, t, 1.0, 1.0);
    let edges = tap(uv, t, 0.0, -1.0) + tap(uv, t, -1.0, 0.0) + tap(uv, t, 1.0, 0.0) + tap(uv, t, 0.0, 1.0);
    let col = (tap(uv, t, 0.0, 0.0) * 4.0 + edges * 2.0 + corners) * (1.0 / 16.0);
    return vec4<f32>(col * post.bloom.w, 1.0);
}

// Metering: coverage-weighted log2 luminance of the (premultiplied) scene, 4 bilinear taps per
// texel of the 64 x 64 level; the background (alpha 0) is not metered
fn meter(uv: vec2<f32>) -> vec2<f32> {
    let c = textureSampleLevel(src_tex, src_sampler, uv, 0.0);
    let covered = c.a > 0.001;
    let l = log2(max(luma(c.rgb) / max(c.a, 0.001), 1e-5));
    return select(vec2<f32>(0.0), vec2<f32>(l * c.a, c.a), covered);
}

@fragment
fn fs_lum(in: PostOutput) -> @location(0) vec4<f32> {
    let o = 0.25 / 64.0;
    let m = meter(in.uv + vec2<f32>(-o, -o)) + meter(in.uv + vec2<f32>(o, -o))
        + meter(in.uv + vec2<f32>(-o, o)) + meter(in.uv + vec2<f32>(o, o));
    return vec4<f32>(m * 0.25, 0.0, 1.0);
}

// 4 x 4 box reduction (64 -> 16 -> 4 -> 1)
@fragment
fn fs_lum_reduce(in: PostOutput) -> @location(0) vec4<f32> {
    let base = vec2<i32>(in.position.xy) * 4;
    let last = vec2<i32>(textureDimensions(src_tex, 0)) - vec2<i32>(1);
    var s = vec2<f32>(0.0);
    for (var y = 0; y < 4; y++) {
        for (var x = 0; x < 4; x++) {
            s += textureLoad(src_tex, min(base + vec2<i32>(x, y), last), 0).xy;
        }
    }
    return vec4<f32>(s * (1.0 / 16.0), 0.0, 1.0);
}

// Temporal adaptation (1 x 1): target EV of the metered average, approached by this frame's
// blend; the first frame (invalid state) and instant adaptation snap
@fragment
fn fs_adapt(in: PostOutput) -> @location(0) vec4<f32> {
    let m = textureLoad(src_tex, vec2<i32>(0, 0), 0).xy;
    let prev = textureLoad(aux_tex, vec2<i32>(0, 0), 0);
    let valid = prev.y > 0.5;
    let metered = m.x / max(m.y, 1e-6) - log2(0.18);
    let fallback = select(0.0, prev.x, valid);
    let target_ev = clamp(select(fallback, metered, m.y > 1e-4), post.adapt.x, post.adapt.y);
    let k = select(post.adapt.w, post.adapt.z, target_ev > prev.x);
    let adapted = prev.x + (target_ev - prev.x) * k;
    let ev = select(adapted, target_ev, !valid || post.misc.y > 0.5);
    return vec4<f32>(ev, 1.0, 0.0, 1.0);
}

fn tone_map(c: vec3<f32>, mode: f32) -> vec3<f32> {
    if (mode > 1.5) {
        return c / (vec3<f32>(1.0) + c);
    }
    if (mode > 0.5) {
        return (c * (2.51 * c + vec3<f32>(0.03))) / (c * (2.43 * c + vec3<f32>(0.59)) + vec3<f32>(0.14));
    }
    return c;
}

fn linear_to_srgb3(c: vec3<f32>) -> vec3<f32> {
    let hi = 1.055 * pow(c, vec3<f32>(1.0 / 2.4)) - vec3<f32>(0.055);
    return select(hi, c * 12.92, c <= vec3<f32>(0.0031308));
}

// Exposure + bloom + tone mapping over the clear color, then the sRGB encode (non-sRGB surface)
@fragment
fn fs_post_composite(in: PostOutput) -> @location(0) vec4<f32> {
    let scene = textureLoad(src_tex, vec2<i32>(in.position.xy), 0);
    var hdr = scene.rgb * exposure_scale();
    if (post.params.w > 0.5) {
        let t = vec2<f32>(1.0) / vec2<f32>(textureDimensions(aux_tex, 0));
        let uv = in.uv;
        let corners = aux_tap(uv, t, -1.0, -1.0) + aux_tap(uv, t, 1.0, -1.0) + aux_tap(uv, t, -1.0, 1.0) + aux_tap(uv, t, 1.0, 1.0);
        let edges = aux_tap(uv, t, 0.0, -1.0) + aux_tap(uv, t, -1.0, 0.0) + aux_tap(uv, t, 1.0, 0.0) + aux_tap(uv, t, 0.0, 1.0);
        let bloom = (aux_tap(uv, t, 0.0, 0.0) * 4.0 + edges * 2.0 + corners) * (1.0 / 16.0);
        hdr += bloom * (post.bloom.z * post.misc.x);
    }
    let a = clamp(scene.a, 0.0, 1.0);
    let mapped = clamp(tone_map(hdr, post.params.y), vec3<f32>(0.0), vec3<f32>(1.0));
    let lin = clamp(mapped + post.clear.rgb * (1.0 - a), vec3<f32>(0.0), vec3<f32>(1.0));
    let rgb = select(lin, linear_to_srgb3(lin), post.params.z > 0.5);
    return vec4<f32>(rgb, a + post.clear.a * (1.0 - a));
}
"#;

/// Fragment entry points of `POST_WGSL`.
pub const POST_ENTRIES: [&str; 7] = [
    "fs_bloom_prefilter",
    "fs_bloom_down",
    "fs_bloom_up",
    "fs_lum",
    "fs_lum_reduce",
    "fs_adapt",
    "fs_post_composite",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bloom_mip_chain_sizes() {
        assert_eq!(
            bloom_mip_sizes(1280, 720),
            vec![
                (640, 360),
                (320, 180),
                (160, 90),
                (80, 45),
                (40, 22),
                (20, 11)
            ]
        );
        assert_eq!(bloom_mip_sizes(480, 300).len(), BLOOM_MAX_MIPS);
        assert_eq!(bloom_mip_sizes(16, 16), vec![(8, 8), (4, 4), (2, 2)]);
        assert_eq!(bloom_mip_sizes(1, 1), vec![(1, 1)]);
        assert_eq!(bloom_mip_sizes(0, 0), vec![(1, 1)]);
        assert_eq!(bloom_mip_sizes(4000, 3), vec![(2000, 1)]);
    }

    #[test]
    fn bloom_norm_keeps_uniform_brightness() {
        assert_eq!(bloom_norm(0.0, 6), 1.0);
        assert!((bloom_norm(1.0, 6) - 1.0 / 6.0).abs() < 1e-6);
        assert!((bloom_norm(0.5, 3) - 1.0 / 1.75).abs() < 1e-6);
        assert_eq!(bloom_norm(0.5, 0), 1.0);
    }

    #[test]
    fn ev_math() {
        // Average 0.18 meters EV 0; 16x brighter is EV +4 (exposure / 16)
        assert!(target_ev(MIDDLE_GREY.log2(), -8.0, 8.0).abs() < 1e-6);
        assert!((target_ev((MIDDLE_GREY * 16.0).log2(), -8.0, 8.0) - 4.0).abs() < 1e-5);
        assert_eq!(target_ev(100.0, -4.0, 4.0), 4.0);
        assert_eq!(target_ev(-100.0, -4.0, 4.0), -4.0);
        assert!((exposure_scale(1.0, 0.0, 4.0) - 1.0 / 16.0).abs() < 1e-7);
        assert!((exposure_scale(2.0, 1.0, 0.0) - 4.0).abs() < 1e-6);
        // Adaptation: speed x dt = ln 2 closes half the gap; up / down use their own speed
        let k = adaptation_blend(std::f32::consts::LN_2, 1.0);
        assert!((k - 0.5).abs() < 1e-6);
        assert_eq!(adaptation_blend(3.0, 0.0), 0.0);
        assert_eq!(adaptation_blend(0.0, 1.0), 0.0);
        assert_eq!(adaptation_blend(1e30, 1e30), 1.0);
        assert!((adapt_ev(0.0, 4.0, 0.5, 0.1) - 2.0).abs() < 1e-6);
        assert!((adapt_ev(4.0, 0.0, 0.5, 0.25) - 3.0).abs() < 1e-6);
        // Converges to the target over frames
        let mut ev = 0.0;
        for _ in 0..200 {
            ev = adapt_ev(ev, 3.0, adaptation_blend(3.0, 1.0 / 60.0), 0.0);
        }
        assert!((ev - 3.0).abs() < 1e-3);
    }

    #[test]
    fn uniform_packing() {
        let frame = PostFrame {
            exposure: 2.0,
            tone_mapping: 1,
            dt: 0.5,
            bloom: Some(BloomParams {
                intensity: 0.8,
                threshold: 1.5,
                knee: 0.5,
                radius: 0.5,
            }),
            auto_exposure: Some(AutoExposureParams {
                min_ev: -2.0,
                max_ev: 6.0,
                speed_up: 2.0,
                speed_down: 1.0,
                compensation: 1.0,
                instant: true,
            }),
        };
        let u = PostUniformRaw::pack(&frame, [1.0, 0.0, 0.5, 1.0], true, 3);
        assert_eq!(u.params, [4.0, 1.0, 1.0, 1.0]);
        assert_eq!(u.bloom, [1.5, 0.75, 0.8, 0.5]);
        assert_eq!(u.adapt[..2], [-2.0, 6.0]);
        assert!((u.adapt[2] - adaptation_blend(2.0, 0.5)).abs() < 1e-7);
        assert_eq!(u.misc[1..3], [1.0, 1.0]);
        assert!((u.misc[0] - 1.0 / 1.75).abs() < 1e-6);
        assert_eq!(u.clear[0], 1.0);
        assert!((u.clear[2] - 0.2140).abs() < 1e-3, "sRGB 0.5 -> linear");
        // sRGB surface: the clear color stays as given; bloom / auto exposure off
        let off = PostUniformRaw::pack(
            &PostFrame {
                bloom: None,
                auto_exposure: None,
                ..frame
            },
            [0.5; 4],
            false,
            6,
        );
        assert_eq!(off.params, [2.0, 1.0, 0.0, 0.0]);
        assert_eq!(off.misc, [0.0; 4]);
        assert_eq!(off.clear, [0.5; 4]);
        assert_eq!(std::mem::size_of::<PostUniformRaw>(), 80);
    }

    #[test]
    fn target_bytes() {
        assert_eq!(post_target_bytes(100, 50, 1, false), 100 * 50 * 8);
        assert_eq!(post_target_bytes(100, 50, 4, false), 100 * 50 * 8 * 5);
        let mips: u64 = bloom_mip_sizes(100, 50)
            .iter()
            .map(|&(w, h)| (w * h) as u64)
            .sum();
        assert_eq!(post_target_bytes(100, 50, 1, true), (100 * 50 + mips) * 8);
        assert_eq!(exposure_bytes(), (64 * 64 + 16 * 16 + 16 + 1 + 2) * 8);
    }

    #[test]
    fn hdr_variant_drops_tone_mapping() {
        let pbr = super::super::shader::mesh_pbr_wgsl();
        let hdr = hdr_mesh_variant(&pbr);
        assert!(!hdr.contains("linear_to_srgb3(mapped)"));
        assert!(hdr.contains(
            "return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(60000.0)), alpha);"
        ));
        for (dir, point) in [(true, false), (false, true), (true, true)] {
            let s = super::super::shader::mesh_shadowed_variant_wgsl(true, dir, point);
            assert!(hdr_mesh_variant(&s).contains("vec3<f32>(60000.0)), alpha);"));
        }
        assert_eq!(HDR_MAX, 60000.0);
    }

    fn validate(src: &str) -> (naga::Module, naga::valid::ModuleInfo) {
        let module = naga::front::wgsl::parse_str(src)
            .unwrap_or_else(|e| panic!("{}", e.emit_to_string(src)));
        let info = naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::empty(),
        )
        .validate(&module)
        .unwrap_or_else(|e| panic!("{e:?}"));
        (module, info)
    }

    fn glsl_es300(
        module: &naga::Module,
        info: &naga::valid::ModuleInfo,
        stage: naga::ShaderStage,
        entry: &str,
    ) -> String {
        use naga::back::glsl;
        let options = glsl::Options {
            version: glsl::Version::Embedded {
                version: 300,
                is_webgl: true,
            },
            ..Default::default()
        };
        let pipeline = glsl::PipelineOptions {
            shader_stage: stage,
            entry_point: entry.into(),
            multiview: None,
        };
        let mut out = String::new();
        glsl::Writer::new(
            &mut out,
            module,
            info,
            &options,
            &pipeline,
            naga::proc::BoundsCheckPolicies::default(),
        )
        .and_then(|mut w| w.write())
        .unwrap_or_else(|e| panic!("{entry}: {e:?}"));
        assert!(out.contains("#version 300 es"));
        out
    }

    #[test]
    fn post_shaders_translate_to_webgl2_glsl() {
        let (module, info) = validate(POST_WGSL);
        glsl_es300(&module, &info, naga::ShaderStage::Vertex, "vs_post");
        for entry in POST_ENTRIES {
            glsl_es300(&module, &info, naga::ShaderStage::Fragment, entry);
        }
    }

    #[test]
    fn hdr_mesh_shaders_translate_to_webgl2_glsl() {
        let mut sources = vec![hdr_mesh_variant(&super::super::shader::mesh_pbr_wgsl())];
        for (dir, point) in [(true, false), (false, true), (true, true)] {
            sources.push(hdr_mesh_variant(
                &super::super::shader::mesh_shadowed_variant_wgsl(true, dir, point),
            ));
        }
        for src in &sources {
            let (module, info) = validate(src);
            glsl_es300(&module, &info, naga::ShaderStage::Vertex, "vs_mesh");
            glsl_es300(&module, &info, naga::ShaderStage::Fragment, "fs_mesh_pbr");
        }
    }
}
