//! Anti-aliased convex polygons shared by the business charts (funnel stages, radar helpers).
//!
//! The fill shader has no coverage term and the canvas no MSAA, so (like pie slices, pie.rs) a
//! polygon is filled 0.5 CSS px inside its true outline and traced with a 1 px stroke in its own
//! color through the segment pipeline: the stroke's coverage ramp runs from 0.5 px inside to
//! 0.5 px outside the edge, so edges are smooth and the visible area stays exact.

use super::pie::AA_PX;
use crate::renderer::{ChartFillRaw, ChartSegmentRaw};

/// Twice the signed area (counter-clockwise > 0).
fn signed_area2(pts: &[(f32, f32)]) -> f32 {
    let n = pts.len();
    (0..n)
        .map(|i| {
            let (a, b) = (pts[i], pts[(i + 1) % n]);
            a.0 * b.1 - b.0 * a.1
        })
        .sum()
}

/// Moves every edge of the convex polygon `pts` (either winding) inward by `d`. `None` when the
/// polygon is degenerate or too small to survive the inset (an edge would flip).
pub(crate) fn inset_convex(pts: &[(f32, f32)], d: f32) -> Option<Vec<(f32, f32)>> {
    let n = pts.len();
    if n < 3 || !d.is_finite() {
        return None;
    }
    let mut p: Vec<(f32, f32)> = pts.to_vec();
    if signed_area2(&p) < 0.0 {
        p.reverse();
    }
    if signed_area2(&p) <= 0.0 {
        return None;
    }
    // Offset line of edge i (p[i] -> p[i + 1]): a point and its direction (inward = left normal)
    let lines: Vec<((f32, f32), (f32, f32))> = (0..n)
        .map(|i| {
            let (a, b) = (p[i], p[(i + 1) % n]);
            let (dx, dy) = (b.0 - a.0, b.1 - a.1);
            let len = dx.hypot(dy).max(1e-12);
            let nrm = (-dy / len, dx / len);
            ((a.0 + nrm.0 * d, a.1 + nrm.1 * d), (dx, dy))
        })
        .collect();
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        // Vertex i joins edge i - 1 and edge i
        let (pa, da) = lines[(i + n - 1) % n];
        let (pb, db) = lines[i];
        let cross = da.0 * db.1 - da.1 * db.0;
        if cross.abs() < 1e-12 * (da.0.hypot(da.1) * db.0.hypot(db.1)).max(1e-30) {
            // Collinear neighbours: the offset vertex is the offset point itself
            out.push(pb);
            continue;
        }
        let t = ((pb.0 - pa.0) * db.1 - (pb.1 - pa.1) * db.0) / cross;
        out.push((pa.0 + da.0 * t, pa.1 + da.1 * t));
    }
    // Every edge must keep its direction (no fold-over) and the area stay positive
    let keeps = (0..n).all(|i| {
        let (a, b) = (out[i], out[(i + 1) % n]);
        let (o0, o1) = (p[i], p[(i + 1) % n]);
        (b.0 - a.0) * (o1.0 - o0.0) + (b.1 - a.1) * (o1.1 - o0.1) > 0.0
    });
    (keeps && signed_area2(&out) > 0.0).then_some(out)
}

/// Appends a convex polygon (world units, `wpp` = world units per CSS px) as fill triangles
/// inset by half the AA stroke plus its 1 px outline strokes. Returns false when it is too
/// small to show.
pub(crate) fn aa_polygon(
    pts: &[(f32, f32)],
    wpp: f32,
    z: f32,
    color: [f32; 4],
    fills: &mut Vec<ChartFillRaw>,
    edges: &mut Vec<ChartSegmentRaw>,
) -> bool {
    let Some(inner) = inset_convex(pts, 0.5 * AA_PX * wpp) else {
        return false;
    };
    let v = |p: (f32, f32)| ChartFillRaw { position: [p.0, p.1, z, 0.0], color };
    for k in 1..inner.len() - 1 {
        fills.extend([v(inner[0]), v(inner[k]), v(inner[k + 1])]);
    }
    let n = inner.len();
    for k in 0..n {
        let (a, b) = (inner[k], inner[(k + 1) % n]);
        edges.push(ChartSegmentRaw { p0_width: [a.0, a.1, z, AA_PX], p1_pad: [b.0, b.1, z, 0.0], color });
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inset_moves_every_edge_inward_by_the_distance() {
        // Square 10 x 10 in clockwise order: inset 1 gives the 8 x 8 square
        let sq = [(0.0, 0.0), (0.0, 10.0), (10.0, 10.0), (10.0, 0.0)];
        let mut got = inset_convex(&sq, 1.0).unwrap();
        got.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.total_cmp(&b.1)));
        assert_eq!(got, vec![(1.0, 1.0), (1.0, 9.0), (9.0, 1.0), (9.0, 9.0)]);
        // Trapezoid: the slanted edge keeps its slope, distance to the original edge == d
        let tr = [(-5.0, 0.0), (5.0, 0.0), (3.0, 4.0), (-3.0, 4.0)];
        let ins = inset_convex(&tr, 0.5).unwrap();
        let (a, b) = (tr[1], tr[2]);
        let dist = |p: (f32, f32)| ((b.0 - a.0) * (a.1 - p.1) - (a.0 - p.0) * (b.1 - a.1)).abs() / (b.0 - a.0).hypot(b.1 - a.1);
        assert!((dist(ins[1]) - 0.5).abs() < 1e-4 && (dist(ins[2]) - 0.5).abs() < 1e-4);
        // Too small: collapses
        assert!(inset_convex(&sq, 6.0).is_none());
        assert!(inset_convex(&[(0.0, 0.0), (1.0, 0.0)], 0.1).is_none());
    }

    #[test]
    fn aa_polygon_fills_inside_and_strokes_the_outline() {
        let (mut fills, mut edges) = (Vec::new(), Vec::new());
        let sq = [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)];
        assert!(aa_polygon(&sq, 1.0, 0.25, [1.0; 4], &mut fills, &mut edges));
        assert_eq!((fills.len(), edges.len()), (6, 4));
        let area: f32 = fills
            .chunks(3)
            .map(|t| {
                let [a, b, c] = [t[0].position, t[1].position, t[2].position];
                0.5 * ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])).abs()
            })
            .sum();
        assert!((area - 81.0).abs() < 1e-3, "9 x 9 after the half-px inset: {area}");
        assert!(fills.iter().all(|f| f.position[2] == 0.25));
        assert!(!aa_polygon(&[(0.0, 0.0), (0.5, 0.0), (0.5, 0.5)], 1.0, 0.0, [1.0; 4], &mut fills, &mut edges));
    }
}
