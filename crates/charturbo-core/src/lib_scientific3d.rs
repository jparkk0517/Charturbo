use crate::{WasmCharturboEngine, chart::{Scientific3DSeries, Scientific3DOptions, Scientific3DContours}};
use wasm_bindgen::prelude::*;

fn decode_options(v: &[f64]) -> Result<(Scientific3DOptions, Option<f32>), String> {
    if v.is_empty() { return Ok((Scientific3DOptions::default(), None)); }
    if v.len() != 15 || ![0., 1., 2.].contains(&v[6]) || ![0., 1.].contains(&v[13])
        || v[10..13].iter().any(|&n| n != 0. && (!(2.0..=50.0).contains(&n) || n.fract() != 0.))
        || (!v[14].is_nan() && (!(v[14] as f32).is_finite() || v[14] as f32 <= 0. || v[13] != 1.)) {
        return Err("invalid packed 3D options".into());
    }
    let options = Scientific3DOptions {
        bounds: std::array::from_fn(|a| ((!v[a * 2].is_nan()).then_some(v[a * 2]), (!v[a * 2 + 1].is_nan()).then_some(v[a * 2 + 1]))),
        aspect: if v[6] == 1. { None } else if v[6] == 0. { Some([1.; 3]) } else { Some([v[7] as f32, v[8] as f32, v[9] as f32]) },
        ticks: [v[10] as u32, v[11] as u32, v[12] as u32],
    };
    options.validate()?;
    Ok((options, (v[13] == 1.).then_some(if v[14].is_nan() { 0. } else { v[14] as f32 })))
}

/// Per series `[levelCount, r, g, b, a, ...levels]`; a zero count means no contours.
/// An empty buffer means no contours for every series.
fn decode_contours(v: &[f32], series: usize) -> Result<Vec<Option<Scientific3DContours>>, String> {
    if v.is_empty() { return Ok(vec![None; series]); }
    let error = || "invalid packed 3D contours".to_string();
    let mut out = Vec::with_capacity(series);
    let mut at = 0;
    for _ in 0..series {
        let head = v.get(at..at + 5).ok_or_else(error)?;
        if head[0] < 0. || head[0].fract() != 0. { return Err(error()); }
        let n = head[0] as usize;
        let levels = v.get(at + 5..at + 5 + n).ok_or_else(error)?;
        out.push((n > 0).then(|| Scientific3DContours { levels: levels.to_vec(), color: [head[1], head[2], head[3], head[4]] }));
        at += 5 + n;
    }
    if at != v.len() { return Err(error()); }
    Ok(out)
}

#[wasm_bindgen]
impl WasmCharturboEngine {
    /// Packed XYZ/RGBA samples, series boundaries, per-series size/lighting/wireframe,
    /// grid shapes (0,0 for clouds) and packed surface contours. Validation precedes replacement.
    pub fn set_chart_3d(&mut self, xyz: &[f32], colors: &[f32], offsets: &[u32], styles: &[f32], shapes: &[u32], config: &[f64], contours: &[f32]) -> Result<usize, JsValue> {
        let (options, orthographic) = decode_options(config).map_err(|e| JsValue::from_str(&e))?;
        let error = || JsValue::from_str("invalid packed 3D chart");
        if xyz.len() % 3 != 0 || colors.len() != xyz.len() / 3 * 4 || offsets.is_empty()
            || offsets[0] != 0 || offsets.last().copied() != Some((xyz.len() / 3) as u32)
            || offsets.windows(2).any(|w| w[0] > w[1]) || styles.len() != (offsets.len() - 1) * 3 || shapes.len() != (offsets.len() - 1) * 2 {
            return Err(error());
        }
        let mut contours = decode_contours(contours, offsets.len() - 1).map_err(|e| JsValue::from_str(&e))?.into_iter();
        let series = offsets.windows(2).enumerate().map(|(s, w)| {
            let (a, b) = (w[0] as usize, w[1] as usize);
            Scientific3DSeries {
                xyz: xyz[a * 3..b * 3].chunks_exact(3).map(|p| [p[0], p[1], p[2]]).collect(),
                colors: colors[a * 4..b * 4].chunks_exact(4).map(|p| [p[0], p[1], p[2], p[3]]).collect(),
                color: [0.2, 0.6, 1., 1.], size: styles[s * 3], lighting: styles[s * 3 + 1], wireframe: styles[s * 3 + 2] != 0.,
                grid: (shapes[s * 2] != 0 || shapes[s * 2 + 1] != 0).then_some((shapes[s * 2] as usize, shapes[s * 2 + 1] as usize)),
                contours: contours.next().flatten(),
            }
        }).collect();
        self.inner.set_scientific3d_with_options(series, options, orthographic).map_err(|e| JsValue::from_str(&e))
    }

    /// Updates one existing series without reframing the camera or resetting its styles.
    /// `contours` is that series' packed record and replaces its isolines.
    pub fn update_chart_3d_series(&mut self, series: usize, xyz: &[f32], colors: &[f32], columns: usize, rows: usize, contours: &[f32]) -> Result<usize, JsValue> {
        if xyz.len() % 3 != 0 || xyz.len() / 3 > 4_000_000 || colors.len() != xyz.len() / 3 * 4 {
            return Err(JsValue::from_str("invalid packed 3D update"));
        }
        let contours = decode_contours(contours, 1).map_err(|e| JsValue::from_str(&e))?.pop().flatten();
        let points = xyz.chunks_exact(3).map(|p| [p[0], p[1], p[2]]).collect();
        let rgba = colors.chunks_exact(4).map(|p| [p[0], p[1], p[2], p[3]]).collect();
        let grid = (columns != 0 || rows != 0).then_some((columns, rows));
        self.inner.update_scientific3d_series(series, points, rgba, grid, contours).map_err(|e| JsValue::from_str(&e))
    }

    /// Raw XYZ, cell column and row of the current pointer intersection.
    pub fn chart_3d_hit(&self) -> Vec<f32> {
        self.inner.chart().and_then(|c| c.scientific_hit()).map_or_else(Vec::new, |p| p.to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packed_contours_are_per_series_records_with_strict_lengths() {
        let c = decode_contours(&[0., 0., 0., 0., 0., 2., 1., 0.5, 0., 0.8, 3., -1.], 2).unwrap();
        assert_eq!(c[0], None);
        assert_eq!(c[1], Some(Scientific3DContours { levels: vec![3., -1.], color: [1., 0.5, 0., 0.8] }));
        assert_eq!(decode_contours(&[], 3).unwrap(), vec![None; 3]);
        for bad in [&[1., 0., 0., 0., 1.][..], &[0., 0., 0., 0., 0., 9.], &[1.5, 0., 0., 0., 1., 2.], &[-1., 0., 0., 0., 1.]] {
            assert!(decode_contours(bad, 1).is_err(), "{bad:?}");
        }
    }
}
