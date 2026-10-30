//! HDR environment maps, CPU side (pure, GPU-free so it is unit tested natively): Radiance
//! `.hdr` (RGBE) decoding, the prefiltered mip chain plan (roughness per mip), f32 -> f16
//! packing, the 9-coefficient spherical harmonics diffuse irradiance and the box-filtered
//! fallback chain for devices that cannot render into `Rgba16Float`.
//!
//! Layout: equirectangular, top row = straight up (+y), u = 0.5 faces -z (`equirect_uv` of the
//! PBR shader). Texels are linear radiance (no sRGB).

/// Largest accepted HDR source (width x height); larger images are rejected, not resized.
pub const MAX_HDR_WIDTH: u32 = 4096;
pub const MAX_HDR_HEIGHT: u32 = 2048;
/// Prefiltered chain base edge: bigger sources are box-downsampled to at most this width
/// (mirror reflections of a 1024 px equirect are ~0.35 degree per texel).
pub const MAX_ENV_BASE_WIDTH: u32 = 1024;
/// Smallest mip height of the prefiltered chain (roughness 1 still keeps up / down apart).
pub const MIN_ENV_MIP_HEIGHT: u32 = 8;
/// Largest finite f16 value: brighter texels are clamped (a 65504 sun stays a sun).
pub const MAX_HALF: f32 = 65504.0;
/// GGX importance samples per prefiltered texel (same count on WebGPU and WebGL2).
pub const PREFILTER_SAMPLES: u32 = 128;

/// Decoded HDR image: `width * height` linear RGB texels, top row first.
#[derive(Debug, Clone, PartialEq)]
pub struct HdrImage {
    pub width: u32,
    pub height: u32,
    pub rgb: Vec<f32>,
}

/// Validates an environment source size and the RGB length (`width * height * 3`).
pub fn check_env_source(width: u32, height: u32, len: usize) -> Result<(), String> {
    if width == 0 || height == 0 {
        return Err("environment width and height must be > 0".into());
    }
    if width > MAX_HDR_WIDTH || height > MAX_HDR_HEIGHT {
        return Err(format!(
            "environment {width}x{height} exceeds the {MAX_HDR_WIDTH}x{MAX_HDR_HEIGHT} limit"
        ));
    }
    let expected = width as usize * height as usize * 3;
    if len != expected {
        return Err(format!(
            "rgb length must be width * height * 3 ({expected}), got {len}"
        ));
    }
    Ok(())
}

/// Parses a Radiance `.hdr` / `.pic` file (`#?` magic, `FORMAT=32-bit_rle_rgbe`, `-Y h +X w`
/// or `+Y h +X w`), flat or new-style run-length encoded scanlines.
pub fn decode_radiance_hdr(bytes: &[u8]) -> Result<HdrImage, String> {
    let mut pos = 0usize;
    if !bytes.starts_with(b"#?") {
        return Err("not a Radiance HDR file (missing #? signature)".into());
    }
    next_line(bytes, &mut pos)?;
    loop {
        let l = next_line(bytes, &mut pos)?;
        if l.is_empty() {
            break;
        }
        if let Some(format) = l.strip_prefix(b"FORMAT=") {
            let format = String::from_utf8_lossy(format);
            if format.trim() != "32-bit_rle_rgbe" {
                return Err(format!(
                    "unsupported HDR format {format} (only 32-bit_rle_rgbe)"
                ));
            }
        }
    }
    let res = String::from_utf8_lossy(
        next_line(bytes, &mut pos).map_err(|_| "missing HDR resolution line")?,
    )
    .into_owned();
    let parts: Vec<&str> = res.split_whitespace().collect();
    let (flip, height, width) = match parts.as_slice() {
        [y, h, "+X", w] if *y == "-Y" || *y == "+Y" => {
            let n = |s: &str| {
                s.parse::<u32>()
                    .map_err(|_| format!("bad HDR resolution line: {res}"))
            };
            (*y == "+Y", n(h)?, n(w)?)
        }
        _ => {
            return Err(format!(
                "unsupported HDR resolution line (expected -Y <h> +X <w>): {res}"
            ))
        }
    };
    if width == 0 || height == 0 {
        return Err(format!("bad HDR resolution line: {res}"));
    }
    if width > MAX_HDR_WIDTH || height > MAX_HDR_HEIGHT {
        return Err(format!(
            "HDR image {width}x{height} exceeds the {MAX_HDR_WIDTH}x{MAX_HDR_HEIGHT} limit"
        ));
    }
    let (w, h) = (width as usize, height as usize);
    let data = &bytes[pos..];
    let mut at = 0usize;
    // Every row takes at least min(flat w * 4, RLE 4 + 4 channels * 2) bytes: reject a short
    // file before allocating the full float image
    if data.len() < h * (w * 4).min(12) {
        return Err("truncated HDR pixel data".to_string());
    }
    let mut rgb = vec![0f32; w * h * 3];
    let mut scan = vec![0u8; w * 4];
    let truncated = || "truncated HDR pixel data".to_string();
    for y in 0..h {
        let rle = (8..=0x7fff).contains(&w)
            && data.len() >= at + 4
            && data[at] == 2
            && data[at + 1] == 2
            && data[at + 2] & 0x80 == 0
            && ((data[at + 2] as usize) << 8 | data[at + 3] as usize) == w;
        if rle {
            at += 4;
            // Channel-planar runs: count > 128 repeats the next byte, else that many literals
            for c in 0..4 {
                let mut x = 0;
                while x < w {
                    let count = *data.get(at).ok_or_else(truncated)? as usize;
                    at += 1;
                    if count > 128 {
                        let n = count - 128;
                        if x + n > w {
                            return Err(format!(
                                "corrupt HDR scanline {y}: run overflows the width"
                            ));
                        }
                        let v = *data.get(at).ok_or_else(truncated)?;
                        at += 1;
                        for i in 0..n {
                            scan[(x + i) * 4 + c] = v;
                        }
                        x += n;
                    } else {
                        if count == 0 || x + count > w {
                            return Err(format!("corrupt HDR scanline {y}: bad literal count"));
                        }
                        let src = data.get(at..at + count).ok_or_else(truncated)?;
                        at += count;
                        for (i, &v) in src.iter().enumerate() {
                            scan[(x + i) * 4 + c] = v;
                        }
                        x += count;
                    }
                }
            }
        } else {
            let src = data.get(at..at + w * 4).ok_or_else(truncated)?;
            scan.copy_from_slice(src);
            at += w * 4;
        }
        let row = if flip { h - 1 - y } else { y };
        for x in 0..w {
            let px = rgbe_to_rgb(&scan[x * 4..x * 4 + 4]);
            rgb[(row * w + x) * 3..(row * w + x) * 3 + 3].copy_from_slice(&px);
        }
    }
    Ok(HdrImage { width, height, rgb })
}

/// Next header line (without `\n` / `\r\n`) starting at `*pos`; lines are capped at 4 KiB.
fn next_line<'a>(bytes: &'a [u8], pos: &mut usize) -> Result<&'a [u8], String> {
    let start = (*pos).min(bytes.len());
    let end = bytes[start..]
        .iter()
        .take(4096)
        .position(|&b| b == b'\n')
        .map(|i| start + i)
        .ok_or("truncated HDR header")?;
    *pos = end + 1;
    let l = &bytes[start..end];
    Ok(l.strip_suffix(b"\r").unwrap_or(l))
}

/// One RGBE texel -> linear RGB (`mantissa * 2^(e - 136)`, the `stb_image` convention).
pub fn rgbe_to_rgb(p: &[u8]) -> [f32; 3] {
    if p[3] == 0 {
        return [0.0; 3];
    }
    let f = 2f32.powi(p[3] as i32 - 136);
    [p[0] as f32 * f, p[1] as f32 * f, p[2] as f32 * f]
}

/// Mip levels of the prefiltered chain of a `width x height` base: down to a mip height of
/// `MIN_ENV_MIP_HEIGHT` (1 level for smaller bases).
pub fn prefilter_levels(width: u32, height: u32) -> u32 {
    let full = super::texture::mip_level_count(width, height);
    let mut levels = 1;
    while levels < full && (height >> levels) >= MIN_ENV_MIP_HEIGHT && (width >> levels) >= 1 {
        levels += 1;
    }
    levels
}

/// GGX roughness a mip of the prefiltered chain is convolved for (`level / (levels - 1)`; the
/// shader samples `lod = roughness * (levels - 1)`).
pub fn level_roughness(level: u32, levels: u32) -> f32 {
    if levels <= 1 {
        0.0
    } else {
        level as f32 / (levels - 1) as f32
    }
}

/// Bytes of an `Rgba16Float` chain with `levels` mips.
pub fn env_byte_size(width: u32, height: u32, levels: u32) -> u64 {
    super::texture::texture_byte_size(width, height, levels) * 2
}

/// Replaces non-finite / negative values by 0 and clamps to the f16 range.
pub fn sanitize_radiance(v: f32) -> f32 {
    if v.is_finite() && v > 0.0 {
        v.min(MAX_HALF)
    } else {
        0.0
    }
}

/// IEEE 754 binary16 bits of `v` (round to nearest even; overflow -> inf, NaN -> NaN).
pub fn f32_to_f16_bits(v: f32) -> u16 {
    let x = v.to_bits();
    let sign = ((x >> 16) & 0x8000) as u16;
    let exp = ((x >> 23) & 0xff) as i32;
    let man = x & 0x7f_ffff;
    if exp == 0xff {
        return sign | 0x7c00 | if man != 0 { 0x200 } else { 0 };
    }
    let e = exp - 127 + 15;
    if e >= 0x1f {
        return sign | 0x7c00;
    }
    if e <= 0 {
        if e < -10 {
            return sign;
        }
        // Subnormal: shift the implicit 1 in, round to nearest even
        let m = man | 0x80_0000;
        let shift = (14 - e) as u32;
        let half = 1u32 << (shift - 1);
        let rest = m & ((1 << shift) - 1);
        let mut h = m >> shift;
        if rest > half || (rest == half && h & 1 == 1) {
            h += 1;
        }
        return sign | h as u16;
    }
    let mut h = ((e as u32) << 10) | (man >> 13);
    let rest = man & 0x1fff;
    if rest > 0x1000 || (rest == 0x1000 && h & 1 == 1) {
        // May carry into the exponent (up to inf), which is the correct rounding
        h += 1;
    }
    sign | h as u16
}

/// `Rgba16Float` texels (alpha 1) of linear RGB data.
pub fn pack_rgba16f(rgb: &[f32]) -> Vec<u8> {
    let one = f32_to_f16_bits(1.0).to_le_bytes();
    let mut out = Vec::with_capacity(rgb.len() / 3 * 8);
    for px in rgb.chunks_exact(3) {
        for &c in px {
            out.extend_from_slice(&f32_to_f16_bits(sanitize_radiance(c)).to_le_bytes());
        }
        out.extend_from_slice(&one);
    }
    out
}

/// 2 x 2 box downsample (odd edges: the last row / column is averaged with itself).
pub fn downsample_rgb(width: u32, height: u32, rgb: &[f32]) -> (u32, u32, Vec<f32>) {
    let (w, h) = (width as usize, height as usize);
    let (nw, nh) = ((w / 2).max(1), (h / 2).max(1));
    let mut out = vec![0f32; nw * nh * 3];
    for y in 0..nh {
        let (y0, y1) = ((y * 2).min(h - 1), (y * 2 + 1).min(h - 1));
        for x in 0..nw {
            let (x0, x1) = ((x * 2).min(w - 1), (x * 2 + 1).min(w - 1));
            for c in 0..3 {
                let at = |xx: usize, yy: usize| rgb[(yy * w + xx) * 3 + c];
                out[(y * nw + x) * 3 + c] =
                    0.25 * (at(x0, y0) + at(x1, y0) + at(x0, y1) + at(x1, y1));
            }
        }
    }
    (nw as u32, nh as u32, out)
}

/// Size of the prefiltered base of a `width x height` source (`env_base`).
pub fn env_base_size(width: u32, height: u32) -> (u32, u32) {
    let (mut w, mut h) = (width, height);
    while w > MAX_ENV_BASE_WIDTH {
        (w, h) = ((w / 2).max(1), (h / 2).max(1));
    }
    (w, h)
}

/// Sanitized source downsampled until its width is at most `MAX_ENV_BASE_WIDTH`.
pub fn env_base(width: u32, height: u32, rgb: &[f32]) -> (u32, u32, Vec<f32>) {
    let mut cur = (
        width,
        height,
        rgb.iter()
            .map(|&v| sanitize_radiance(v))
            .collect::<Vec<_>>(),
    );
    while cur.0 > MAX_ENV_BASE_WIDTH {
        cur = downsample_rgb(cur.0, cur.1, &cur.2);
    }
    cur
}

/// Direction of the equirect texel center `(x, y)` (inverse of the shader's `equirect_uv`).
pub fn equirect_dir(x: u32, y: u32, width: u32, height: u32) -> [f32; 3] {
    use std::f32::consts::PI;
    let u = (x as f32 + 0.5) / width as f32;
    let v = (y as f32 + 0.5) / height as f32;
    let (theta, phi) = (v * PI, (u - 0.5) * 2.0 * PI);
    [
        theta.sin() * phi.sin(),
        theta.cos(),
        -theta.sin() * phi.cos(),
    ]
}

/// Real SH basis polynomials (bands 0..2) without their normalization constants.
fn sh_poly(d: [f32; 3]) -> [f32; 9] {
    let [x, y, z] = d;
    [
        1.0,
        y,
        z,
        x,
        x * y,
        y * z,
        3.0 * z * z - 1.0,
        x * z,
        x * x - y * y,
    ]
}

/// SH normalization constants of `sh_poly`.
const SH_NORM: [f32; 9] = [
    0.282_094_8,
    0.488_602_5,
    0.488_602_5,
    0.488_602_5,
    1.092_548_4,
    1.092_548_4,
    0.315_391_57,
    1.092_548_4,
    0.546_274_2,
];

/// Diffuse irradiance / PI (the radiance a white Lambert surface reflects) as 9 SH terms
/// premultiplied by their normalization and cosine-lobe constants (Ramamoorthi & Hanrahan
/// 2001): `E(n) / PI = sum(k[i] * sh_poly(n)[i])` (`irradiance_sh_eval`, the shader's
/// `env_irradiance`). `rgb` is the equirect source; `w` (alpha) is unused.
pub fn irradiance_sh(width: u32, height: u32, rgb: &[f32]) -> [[f32; 4]; 9] {
    use std::f64::consts::PI;
    // A 64 px wide copy is plenty for the low-frequency diffuse response
    let (mut w, mut h, mut data) = (width, height, std::borrow::Cow::Borrowed(rgb));
    while w > 64 {
        let (nw, nh, next) = downsample_rgb(w, h, &data);
        (w, h, data) = (nw, nh, std::borrow::Cow::Owned(next));
    }
    let mut acc = [[0f64; 3]; 9];
    let texel = (2.0 * PI / w as f64) * (PI / h as f64);
    for y in 0..h {
        let theta = (y as f64 + 0.5) / h as f64 * PI;
        let weight = texel * theta.sin();
        for x in 0..w {
            let d = equirect_dir(x, y, w, h);
            let p = sh_poly(d);
            let i = ((y * w + x) * 3) as usize;
            for k in 0..9 {
                let b = weight * (SH_NORM[k] * p[k]) as f64;
                for c in 0..3 {
                    acc[k][c] += b * sanitize_radiance(data[i + c]) as f64;
                }
            }
        }
    }
    // Cosine lobe convolution A_l / PI: 1, 2/3, 1/4
    let band = [
        1.0,
        2.0 / 3.0,
        2.0 / 3.0,
        2.0 / 3.0,
        0.25,
        0.25,
        0.25,
        0.25,
        0.25,
    ];
    let mut out = [[0f32; 4]; 9];
    for k in 0..9 {
        for c in 0..3 {
            out[k][c] = (acc[k][c] * band[k] * SH_NORM[k] as f64) as f32;
        }
    }
    out
}

/// Evaluates `irradiance_sh` along the unit normal `n` (clamped at 0, like the shader).
pub fn irradiance_sh_eval(sh: &[[f32; 4]; 9], n: [f32; 3]) -> [f32; 3] {
    let p = sh_poly(n);
    [0, 1, 2].map(|c| (0..9).map(|k| sh[k][c] * p[k]).sum::<f32>().max(0.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header(res: &str) -> Vec<u8> {
        format!("#?RADIANCE\n# made by a test\nFORMAT=32-bit_rle_rgbe\nEXPOSURE=1.0\n\n{res}\n")
            .into_bytes()
    }

    #[test]
    fn rgbe_texels_decode_like_stb_image() {
        assert_eq!(rgbe_to_rgb(&[128, 128, 128, 129]), [1.0, 1.0, 1.0]);
        assert_eq!(
            rgbe_to_rgb(&[255, 0, 64, 0]),
            [0.0, 0.0, 0.0],
            "e = 0 is black"
        );
        assert_eq!(rgbe_to_rgb(&[128, 64, 32, 136]), [128.0, 64.0, 32.0]);
    }

    #[test]
    fn decodes_flat_scanlines_and_flips_plus_y() {
        // Width 2 < 8: flat texels only
        let mut f = header("-Y 2 +X 2");
        f.extend_from_slice(&[
            128, 0, 0, 129, 0, 128, 0, 129, 0, 0, 128, 130, 128, 128, 128, 133,
        ]);
        let img = decode_radiance_hdr(&f).unwrap();
        assert_eq!((img.width, img.height), (2, 2));
        assert_eq!(&img.rgb[0..6], &[1.0, 0.0, 0.0, 0.0, 1.0, 0.0]);
        assert_eq!(
            &img.rgb[6..12],
            &[0.0, 0.0, 2.0, 16.0, 16.0, 16.0],
            "values > 1 survive"
        );
        let mut f = header("+Y 2 +X 2");
        f.extend_from_slice(&[
            128, 0, 0, 129, 0, 128, 0, 129, 0, 0, 128, 130, 128, 128, 128, 133,
        ]);
        let flipped = decode_radiance_hdr(&f).unwrap();
        assert_eq!(
            &flipped.rgb[0..6],
            &[0.0, 0.0, 2.0, 16.0, 16.0, 16.0],
            "+Y: bottom row first"
        );
        // CRLF header lines are accepted
        let crlf =
            b"#?RGBE\r\nFORMAT=32-bit_rle_rgbe\r\n\r\n-Y 1 +X 1\r\n\x80\x80\x80\x81".to_vec();
        assert_eq!(decode_radiance_hdr(&crlf).unwrap().rgb, vec![1.0, 1.0, 1.0]);
    }

    #[test]
    fn decodes_new_style_rle_scanlines() {
        // Width 10: R = a run of 10 x 128, G = 10 literals, B = run 4 + 6 literals, E = run 10
        let mut f = header("-Y 1 +X 10");
        f.extend_from_slice(&[2, 2, 0, 10]);
        f.extend_from_slice(&[128 + 10, 128]);
        f.push(10);
        f.extend((0..10).map(|i| i * 10));
        f.extend_from_slice(&[128 + 4, 0, 6, 1, 2, 3, 4, 5, 6]);
        f.extend_from_slice(&[128 + 10, 129]);
        let img = decode_radiance_hdr(&f).unwrap();
        assert_eq!(img.width, 10);
        for x in 0..10 {
            let px = &img.rgb[x * 3..x * 3 + 3];
            let b = if x < 4 { 0.0 } else { (x - 3) as f32 / 128.0 };
            assert_eq!(px, &[1.0, (x * 10) as f32 / 128.0, b], "texel {x}");
        }
        // Mixed: an RLE row followed by a flat row (allowed by the format)
        let mut two = header("-Y 2 +X 8");
        two.extend_from_slice(&[2, 2, 0, 8, 136, 128, 136, 128, 136, 128, 136, 129]);
        for _ in 0..8 {
            two.extend_from_slice(&[64, 64, 64, 129]);
        }
        let img = decode_radiance_hdr(&two).unwrap();
        assert_eq!(img.rgb[0], 1.0);
        assert_eq!(img.rgb[8 * 3], 0.5);
    }

    #[test]
    fn bad_files_fail_with_clear_errors() {
        let err = |b: &[u8]| decode_radiance_hdr(b).unwrap_err();
        assert!(err(b"P6\n1 1\n255\n").contains("missing #? signature"));
        assert!(err(b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n").contains("truncated HDR header"));
        assert!(
            err(b"#?RADIANCE\nFORMAT=32-bit_rle_xyze\n\n-Y 1 +X 1\n\0\0\0\0")
                .contains("unsupported HDR format")
        );
        assert!(err(&header("+X 4 -Y 2")).contains("unsupported HDR resolution line"));
        assert!(err(&header("-Y two +X 4")).contains("bad HDR resolution line"));
        assert!(err(&header("-Y 0 +X 4")).contains("bad HDR resolution line"));
        let mut short = header("-Y 2 +X 2");
        short.extend_from_slice(&[1, 2, 3, 4]);
        assert!(err(&short).contains("truncated HDR pixel data"));
        let mut overflow = header("-Y 1 +X 8");
        overflow.extend_from_slice(&[2, 2, 0, 8, 128 + 9, 1, 0, 0, 0, 0, 0, 0]);
        assert!(err(&overflow).contains("run overflows"));
        let mut zero = header("-Y 1 +X 8");
        zero.extend_from_slice(&[2, 2, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0]);
        assert!(err(&zero).contains("bad literal count"));
    }

    #[test]
    fn size_cap_rejects_huge_images_before_allocating() {
        let e = decode_radiance_hdr(&header("-Y 2048 +X 8192")).unwrap_err();
        assert_eq!(e, "HDR image 8192x2048 exceeds the 4096x2048 limit");
        assert!(decode_radiance_hdr(&header("-Y 4096 +X 4096"))
            .unwrap_err()
            .contains("exceeds"));
        assert!(check_env_source(4096, 2048, 4096 * 2048 * 3).is_ok());
        assert!(check_env_source(4097, 1, 4097 * 3)
            .unwrap_err()
            .contains("4096x2048 limit"));
        assert!(check_env_source(2, 1, 5)
            .unwrap_err()
            .contains("width * height * 3"));
        assert!(check_env_source(0, 1, 0).is_err());
    }

    #[test]
    fn prefilter_chain_levels_and_roughness() {
        assert_eq!(prefilter_levels(1024, 512), 7, "512 .. 8 px high");
        assert_eq!(prefilter_levels(256, 128), 5);
        assert_eq!(prefilter_levels(16, 8), 1);
        assert_eq!(prefilter_levels(4, 2), 1, "tiny bases keep one level");
        assert_eq!(prefilter_levels(64, 64), 4);
        assert_eq!(level_roughness(0, 7), 0.0);
        assert_eq!(level_roughness(6, 7), 1.0);
        assert!((level_roughness(3, 7) - 0.5).abs() < 1e-7);
        assert_eq!(level_roughness(0, 1), 0.0);
        assert_eq!(env_byte_size(4, 2, 2), (8 + 2) * 8);
        // Sources wider than the base cap are box-downsampled by powers of two
        let (w, h, data) = env_base(4096, 2048, &vec![2.0; 4096 * 2048 * 3]);
        assert_eq!((w, h, data.len()), (1024, 512, 1024 * 512 * 3));
        assert!(data.iter().all(|&v| v == 2.0));
        assert_eq!(env_base_size(4096, 2048), (1024, 512));
        assert_eq!(env_base_size(1500, 700), (750, 350));
        let (w, h, _) = env_base(300, 150, &vec![0.0; 300 * 150 * 3]);
        assert_eq!((w, h), (300, 150));
    }

    #[test]
    fn half_floats_round_and_clamp() {
        assert_eq!(f32_to_f16_bits(0.0), 0);
        assert_eq!(f32_to_f16_bits(1.0), 0x3c00);
        assert_eq!(f32_to_f16_bits(-2.0), 0xc000);
        assert_eq!(f32_to_f16_bits(65504.0), 0x7bff);
        assert_eq!(f32_to_f16_bits(1e6), 0x7c00, "overflow -> inf");
        assert_eq!(f32_to_f16_bits(0.5 + 1.0 / 4096.0), 0x3800, "ties to even");
        assert_eq!(f32_to_f16_bits(6.0e-8), 0x0001, "smallest subnormal");
        assert_eq!(f32_to_f16_bits(1e-9), 0);
        assert_eq!(f32_to_f16_bits(1000.0), 0x63d0);
        assert_eq!(sanitize_radiance(f32::NAN), 0.0);
        assert_eq!(sanitize_radiance(-1.0), 0.0);
        assert_eq!(sanitize_radiance(1e9), MAX_HALF);
        let packed = pack_rgba16f(&[1.0, 2.0, f32::INFINITY]);
        assert_eq!(packed, [0x00, 0x3c, 0x00, 0x40, 0x00, 0x00, 0x00, 0x3c]);
        let (w, h, d) = downsample_rgb(3, 1, &[1.0, 1.0, 1.0, 3.0, 3.0, 3.0, 8.0, 8.0, 8.0]);
        assert_eq!((w, h), (1, 1));
        assert_eq!(d, vec![2.0, 2.0, 2.0]);
    }

    #[test]
    fn equirect_directions_match_the_shader_mapping() {
        let up = equirect_dir(0, 0, 4, 2000);
        assert!(up[1] > 0.999, "top row is +y");
        // u = 0.5 faces -z
        let fwd = equirect_dir(50, 50, 101, 101);
        assert!((fwd[2] + 1.0).abs() < 1e-4 && fwd[0].abs() < 1e-4);
    }

    #[test]
    fn sh_irradiance_of_constant_and_linear_environments() {
        let (w, h) = (128, 64);
        let constant = vec![2.0f32; (w * h * 3) as usize];
        let sh = irradiance_sh(w, h, &constant);
        for n in [
            [0.0, 1.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 0.0, -1.0],
            [0.6, -0.8, 0.0],
        ] {
            let e = irradiance_sh_eval(&sh, n);
            assert!((e[0] - 2.0).abs() < 0.01, "{n:?}: {e:?}");
        }
        // L = 1 + d.y  ->  E / PI = 1 + (2 / 3) n.y
        let mut linear = vec![0f32; (w * h * 3) as usize];
        for y in 0..h {
            for x in 0..w {
                let d = equirect_dir(x, y, w, h);
                linear[((y * w + x) * 3) as usize..][..3].fill(1.0 + d[1]);
            }
        }
        let sh = irradiance_sh(w, h, &linear);
        for (n, want) in [
            ([0.0, 1.0, 0.0], 5.0 / 3.0),
            ([0.0, -1.0, 0.0], 1.0 / 3.0),
            ([1.0, 0.0, 0.0], 1.0),
        ] {
            let e = irradiance_sh_eval(&sh, n);
            assert!((e[1] - want).abs() < 0.01, "{n:?}: {e:?} vs {want}");
        }
    }
}
