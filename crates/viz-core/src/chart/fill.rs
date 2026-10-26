//! Filled-area tessellation shared by area / band charts (triangle lists for `ChartFillRaw`).

use crate::renderer::ChartFillRaw;

/// Appends the band between two polylines sampled at the same world `xs` as a triangle list.
/// Spans with a non-finite endpoint leave a gap; spans where the lines cross are split at the
/// crossing so neither half folds over the other.
pub fn band_triangles(
    xs: &[f32],
    y_top: &[f32],
    y_bottom: &[f32],
    z: f32,
    color: [f32; 4],
    out: &mut Vec<ChartFillRaw>,
) {
    let n = xs.len().min(y_top.len()).min(y_bottom.len());
    let v = |x: f32, y: f32| ChartFillRaw {
        position: [x, y, z, 0.0],
        color,
    };
    for i in 1..n {
        let (x0, x1) = (xs[i - 1], xs[i]);
        let (t0, t1) = (y_top[i - 1], y_top[i]);
        let (b0, b1) = (y_bottom[i - 1], y_bottom[i]);
        // Gaps, and zero-width spans (vertical steps, tied x) that cover nothing
        if ![x0, x1, t0, t1, b0, b1].iter().all(|c| c.is_finite()) || x0 == x1 {
            continue;
        }
        let (d0, d1) = (t0 - b0, t1 - b1);
        if d0 * d1 < 0.0 {
            // Lines cross inside the span: one triangle on each side of the crossing
            let f = d0 / (d0 - d1);
            let xc = x0 + (x1 - x0) * f;
            let yc = t0 + (t1 - t0) * f;
            out.extend([v(x0, t0), v(x0, b0), v(xc, yc), v(xc, yc), v(x1, t1), v(x1, b1)]);
        } else {
            out.extend([v(x0, t0), v(x0, b0), v(x1, b1), v(x0, t0), v(x1, b1), v(x1, t1)]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn area(tri: &[ChartFillRaw]) -> f32 {
        let [a, b, c] = [tri[0].position, tri[1].position, tri[2].position];
        0.5 * ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])).abs()
    }

    #[test]
    fn band_covers_the_area_between_the_lines_and_skips_gaps() {
        let mut out = Vec::new();
        let xs = [0.0, 1.0, 2.0, 3.0];
        band_triangles(&xs, &[2.0, 2.0, f32::NAN, 2.0], &[0.0; 4], 0.5, [1.0; 4], &mut out);
        // Only span 0-1 is finite: 2 triangles of total area 2
        assert_eq!(out.len(), 6);
        let total: f32 = out.chunks(3).map(area).sum();
        assert!((total - 2.0).abs() < 1e-5);
        assert!(out.iter().all(|v| v.position[2] == 0.5));
    }

    #[test]
    fn crossing_lines_split_at_the_intersection() {
        let mut out = Vec::new();
        band_triangles(&[0.0, 2.0], &[1.0, -1.0], &[0.0, 0.0], 0.0, [1.0; 4], &mut out);
        assert_eq!(out.len(), 6);
        assert_eq!(out[2].position[..2], [1.0, 0.0]);
        // Two triangles of area 0.5 each (no fold-over)
        let total: f32 = out.chunks(3).map(area).sum();
        assert!((total - 1.0).abs() < 1e-5);
    }
}
