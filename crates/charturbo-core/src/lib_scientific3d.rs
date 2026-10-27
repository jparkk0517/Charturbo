use crate::{WasmCharturboEngine, chart::Scientific3DSeries};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl WasmCharturboEngine {
    /// Packed XYZ/RGBA samples, series boundaries, per-series size/lighting/wireframe,
    /// and grid shapes (0,0 for clouds). Validation precedes replacement.
    pub fn set_chart_3d(&mut self, xyz: &[f32], colors: &[f32], offsets: &[u32], styles: &[f32], shapes: &[u32]) -> Result<usize, JsValue> {
        let error = || JsValue::from_str("invalid packed 3D chart");
        if xyz.len() % 3 != 0 || colors.len() != xyz.len() / 3 * 4 || offsets.is_empty()
            || offsets[0] != 0 || offsets.last().copied() != Some((xyz.len() / 3) as u32)
            || offsets.windows(2).any(|w| w[0] > w[1]) || styles.len() != (offsets.len() - 1) * 3 || shapes.len() != (offsets.len() - 1) * 2 {
            return Err(error());
        }
        let series = offsets.windows(2).enumerate().map(|(s, w)| {
            let (a, b) = (w[0] as usize, w[1] as usize);
            Scientific3DSeries {
                xyz: xyz[a * 3..b * 3].chunks_exact(3).map(|p| [p[0], p[1], p[2]]).collect(),
                colors: colors[a * 4..b * 4].chunks_exact(4).map(|p| [p[0], p[1], p[2], p[3]]).collect(),
                color: [0.2, 0.6, 1., 1.], size: styles[s * 3], lighting: styles[s * 3 + 1], wireframe: styles[s * 3 + 2] != 0.,
                grid: (shapes[s * 2] != 0 || shapes[s * 2 + 1] != 0).then_some((shapes[s * 2] as usize, shapes[s * 2 + 1] as usize)),
            }
        }).collect();
        self.inner.set_scientific3d(series).map_err(|e| JsValue::from_str(&e))
    }

    /// Raw XYZ, cell column and row of the current pointer intersection.
    pub fn chart_3d_hit(&self) -> Vec<f32> {
        self.inner.chart().and_then(|c| c.scientific_hit()).map_or_else(Vec::new, |p| p.to_vec())
    }
}
