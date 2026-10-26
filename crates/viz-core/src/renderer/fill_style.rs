//! Fill-layer emphasis on the GPU: fill vertices carry an emphasis tag in `position[3]` and the
//! fill shader dims / fades them by a small uniform (`ChartFillStyleRaw`), so a hover or legend
//! emphasis change uploads 48 bytes plus the few vertices whose lit flag flips, instead of
//! re-staging every fill vertex (a 10k-node sankey has ~1.3M of them).
//!
//! Tag = `kind | lit << 2 | key << 3` as an exact float (0 = never changes):
//! - kind `FILL_EMPH_ALPHA` (sankey links): lit alpha = min(alpha + boost, 1), else alpha * dim
//! - kind `FILL_EMPH_FADE` (nodes, cells): unlit rgb mixes toward the surface
//! - lit: the vertex belongs to the emphasized set (set per vertex, re-written on change)
//! - key: group (`1..`, 0 = none) lit when it equals the uniform's key (legend emphasis: no vertex
//!   is re-written)
//!
//! `ChartFillStyleRaw::resolve` is the CPU mirror of the shader (SVG export, tests).

use super::ChartFillRaw;
use bytemuck::{Pod, Zeroable};
use std::borrow::Cow;

/// Tag kinds (see the module docs).
pub const FILL_EMPH_ALPHA: u32 = 1;
pub const FILL_EMPH_FADE: u32 = 2;
const FILL_EMPH_LIT: u32 = 4;

/// Emphasis tag of a fill vertex (`position[3]`).
pub fn fill_emphasis_tag(kind: u32, lit: bool, key: u32) -> f32 {
    (kind | if lit { FILL_EMPH_LIT } else { 0 } | key << 3) as f32
}

/// The same tag with the lit flag set / cleared.
pub fn with_lit(tag: f32, lit: bool) -> f32 {
    let code = tag as u32 & !FILL_EMPH_LIT;
    (code | if lit { FILL_EMPH_LIT } else { 0 }) as f32
}

/// Fill emphasis uniform (48 bytes). Zeroed = off (every vertex keeps its color).
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Pod, Zeroable, Default)]
pub struct ChartFillStyleRaw {
    /// `[on (0 / 1), lit alpha boost, unlit alpha factor, unlit fade toward the surface]`
    pub emphasis: [f32; 4],
    /// Surface color unlit fade vertices mix toward (alpha unused)
    pub surface: [f32; 4],
    /// `[emphasized group key (0 = none), 0, 0, 0]`
    pub key: [f32; 4],
}

impl ChartFillStyleRaw {
    pub fn is_on(&self) -> bool {
        self.emphasis[0] >= 0.5
    }

    /// Color the fill shader draws for vertex `f` (same operations as `fill_color` in WGSL).
    pub fn resolve(&self, f: &ChartFillRaw) -> [f32; 4] {
        let c = f.color;
        let code = (f.position[3].max(0.0) + 0.5) as u32;
        let e = self.emphasis;
        if code == 0 || !self.is_on() {
            return c;
        }
        let key = code >> 3;
        let lit = code & FILL_EMPH_LIT != 0 || (key != 0 && key as f32 == self.key[0]);
        if code & FILL_EMPH_ALPHA != 0 {
            return [c[0], c[1], c[2], if lit { (c[3] + e[1]).min(1.0) } else { c[3] * e[2] }];
        }
        if lit {
            return c;
        }
        let s = self.surface;
        [c[0] + (s[0] - c[0]) * e[3], c[1] + (s[1] - c[1]) * e[3], c[2] + (s[2] - c[2]) * e[3], c[3]]
    }

    /// `fills` with the emphasis applied (borrowed when it is off).
    pub fn resolved<'a>(&self, fills: &'a [ChartFillRaw]) -> Cow<'a, [ChartFillRaw]> {
        if !self.is_on() {
            return Cow::Borrowed(fills);
        }
        Cow::Owned(fills.iter().map(|f| ChartFillRaw { position: [f.position[0], f.position[1], f.position[2], 0.0], color: self.resolve(f) }).collect())
    }
}

/// Re-written vertex ranges `[start, end)` of an unchanged-length fill layer (`fills` = the whole
/// staged layer the ranges index into).
#[derive(Debug, Default, Clone, Copy)]
pub struct ChartFillPatch<'a> {
    pub fills: &'a [ChartFillRaw],
    pub ranges: &'a [(u32, u32)],
}

impl ChartFillPatch<'_> {
    pub fn bytes(&self) -> u64 {
        let n: u64 = self.ranges.iter().map(|&(a, b)| u64::from(b.saturating_sub(a))).sum();
        n * std::mem::size_of::<ChartFillRaw>() as u64
    }
}

/// Sorts `ranges` and merges touching / overlapping ones (fewer, larger buffer writes).
pub fn merge_ranges(ranges: &mut Vec<(u32, u32)>) {
    ranges.retain(|r| r.1 > r.0);
    ranges.sort_unstable();
    let mut out: Vec<(u32, u32)> = Vec::with_capacity(ranges.len());
    for &(a, b) in ranges.iter() {
        match out.last_mut() {
            Some(last) if a <= last.1 => last.1 = last.1.max(b),
            _ => out.push((a, b)),
        }
    }
    *ranges = out;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::renderer::shader::chart_fill_wgsl;

    fn v(color: [f32; 4], tag: f32) -> ChartFillRaw {
        ChartFillRaw { position: [0.0, 0.0, 0.0, tag], color }
    }

    #[test]
    fn layout_and_tags() {
        assert_eq!(std::mem::size_of::<ChartFillStyleRaw>(), 48);
        let t = fill_emphasis_tag(FILL_EMPH_FADE, false, 5);
        assert_eq!(t, (2 | 5 << 3) as f32);
        assert_eq!(with_lit(t, true), (2 | 4 | 5 << 3) as f32);
        assert_eq!(with_lit(with_lit(t, true), false), t);
        let mut r = vec![(10, 12), (0, 4), (4, 6), (11, 15), (20, 20)];
        merge_ranges(&mut r);
        assert_eq!(r, vec![(0, 6), (10, 15)]);
    }

    #[test]
    fn resolve_dims_fades_and_keys() {
        let c = [0.2, 0.4, 0.6, 0.5];
        let mut s = ChartFillStyleRaw { emphasis: [0.0, 0.35, 0.3, 0.6], surface: [1.0, 1.0, 1.0, 1.0], key: [3.0, 0.0, 0.0, 0.0] };
        // Off: untouched
        assert_eq!(s.resolve(&v(c, fill_emphasis_tag(FILL_EMPH_ALPHA, false, 0))), c);
        s.emphasis[0] = 1.0;
        assert_eq!(s.resolve(&v(c, 0.0)), c, "untagged vertices never change");
        assert_eq!(s.resolve(&v(c, fill_emphasis_tag(FILL_EMPH_ALPHA, true, 0)))[3], 0.85);
        assert_eq!(s.resolve(&v(c, fill_emphasis_tag(FILL_EMPH_ALPHA, false, 0)))[3], 0.5 * 0.3);
        let faded = s.resolve(&v(c, fill_emphasis_tag(FILL_EMPH_FADE, false, 0)));
        let want = [0.2 + 0.8 * 0.6, 0.4 + 0.6 * 0.6, 0.6 + 0.4 * 0.6, 0.5];
        assert!(faded.iter().zip(want).all(|(a, b)| (a - b).abs() < 1e-6), "{faded:?}");
        assert_eq!(s.resolve(&v(c, fill_emphasis_tag(FILL_EMPH_FADE, true, 0))), c);
        // Group key 3 is lit by the uniform alone
        assert_eq!(s.resolve(&v(c, fill_emphasis_tag(FILL_EMPH_FADE, false, 3))), c);
        assert_eq!(s.resolve(&v(c, fill_emphasis_tag(FILL_EMPH_FADE, false, 2))), faded);
    }

    #[test]
    fn fill_shader_translates_to_webgl2_glsl() {
        // The tag decode (uint ops) and the vertex-stage uniform must survive GLSL ES 3.00
        use naga::back::glsl;
        let src = chart_fill_wgsl();
        let module = naga::front::wgsl::parse_str(&src).unwrap();
        let info = naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::empty())
            .validate(&module)
            .unwrap();
        let options = glsl::Options { version: glsl::Version::Embedded { version: 300, is_webgl: true }, ..Default::default() };
        for (stage, entry) in [(naga::ShaderStage::Vertex, "vs_fill"), (naga::ShaderStage::Fragment, "fs_fill")] {
            let pipeline = glsl::PipelineOptions { shader_stage: stage, entry_point: entry.into(), multiview: None };
            let mut out = String::new();
            glsl::Writer::new(&mut out, &module, &info, &options, &pipeline, naga::proc::BoundsCheckPolicies::default())
                .and_then(|mut w| w.write())
                .unwrap_or_else(|e| panic!("{entry}: {e:?}"));
            assert!(out.contains("#version 300 es"));
        }
    }
}
