//! Cosine k-NN graph over L2-normalized embedding rows (cosine similarity = dot product).

use super::EdgeData;

/// Candidates scanned per row: rows beyond this are sampled with a stride to keep ingestion
/// interactive for large N.
const MAX_SCAN: usize = 800;

/// For each row `i`, keeps the `k_neighbors` most similar candidates with similarity
/// `>= similarity_threshold` (ties keep scan order) and emits edges `i -> neighbor`.
/// Candidates are `i+step, i+2*step, ...` (wrapping), `MAX_SCAN` of them at most.
pub(super) fn cosine_knn_edges(
    normalized: &[f32],
    n: usize,
    dim: usize,
    k_neighbors: usize,
    similarity_threshold: f32,
) -> Vec<EdgeData> {
    let mut edges = Vec::new();
    let k = k_neighbors.min(n.saturating_sub(1));
    if k == 0 || n < 2 {
        return edges;
    }
    let max_scan = MAX_SCAN.min(n);
    let step = (n / max_scan).max(1);
    // Sorted descending; never longer than k, so inserts shift at most k entries
    let mut top: Vec<(u32, f32)> = Vec::with_capacity(k + 1);

    for i in 0..n {
        top.clear();
        let row_i = &normalized[i * dim..(i + 1) * dim];
        let mut idx = (i + 1) % n;
        let mut scanned = 0;
        while scanned < max_scan && idx != i {
            let sim = dot(row_i, &normalized[idx * dim..(idx + 1) * dim]);
            if sim >= similarity_threshold && (top.len() < k || sim > top[k - 1].1) {
                // After every entry >= sim, matching a stable sort of the appended candidate
                let at = top.partition_point(|&(_, s)| s >= sim);
                top.insert(at, (idx as u32, sim));
                top.truncate(k);
            }
            idx = (idx + step) % n;
            scanned += 1;
        }
        edges.extend(top.iter().map(|&(dst, sim)| EdgeData::new(i as u32, dst, sim.clamp(0.1, 2.0))));
    }
    edges
}

/// Dot product with 8 independent accumulators: breaks the serial add chain so it vectorizes
/// natively and pipelines in scalar wasm. Sums differ from a sequential loop by rounding only, so
/// near-ties (or sims within ~1e-6 of the threshold) may order / filter differently.
#[inline]
fn dot(a: &[f32], b: &[f32]) -> f32 {
    let (ca, ra) = a.as_chunks::<8>();
    let (cb, rb) = b.as_chunks::<8>();
    let tail: f32 = ra.iter().zip(rb).map(|(x, y)| x * y).sum();
    let mut acc = [0.0f32; 8];
    for (x, y) in ca.iter().zip(cb) {
        for l in 0..8 {
            acc[l] += x[l] * y[l];
        }
    }
    ((acc[0] + acc[4]) + (acc[1] + acc[5])) + ((acc[2] + acc[6]) + (acc[3] + acc[7])) + tail
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::DeterministicRng;

    /// The pre-optimization implementation (sequential dot, sort after every insert).
    fn reference_knn(normalized: &[f32], n: usize, dim: usize, k_neighbors: usize, similarity_threshold: f32) -> Vec<EdgeData> {
        let mut edges = Vec::new();
        let k = k_neighbors.min(n.saturating_sub(1));
        if k > 0 && n >= 2 {
            let max_scan = 800.min(n);
            let step = (n / max_scan).max(1);
            let mut top_matches: Vec<(u32, f32)> = Vec::with_capacity(k + 1);
            for i in 0..n {
                top_matches.clear();
                let row_i = &normalized[i * dim..(i + 1) * dim];
                let mut idx = (i + 1) % n;
                let mut scanned = 0;
                while scanned < max_scan && idx != i {
                    let row_j = &normalized[idx * dim..(idx + 1) * dim];
                    let mut sim = 0.0f32;
                    for d in 0..dim {
                        sim += row_i[d] * row_j[d];
                    }
                    if sim >= similarity_threshold {
                        if top_matches.len() < k {
                            top_matches.push((idx as u32, sim));
                            top_matches.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
                        } else if sim > top_matches[k - 1].1 {
                            top_matches[k - 1] = (idx as u32, sim);
                            top_matches.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
                        }
                    }
                    idx = (idx + step) % n;
                    scanned += 1;
                }
                for &(dst, sim) in &top_matches {
                    edges.push(EdgeData::new(i as u32, dst, sim.clamp(0.1, 2.0)));
                }
            }
        }
        edges
    }

    /// Clustered unit vectors (`clusters` noisy directions), like real embeddings.
    fn embeddings(n: usize, dim: usize, clusters: usize, seed: u32) -> Vec<f32> {
        let mut rng = DeterministicRng::new(seed);
        let centers: Vec<f32> = (0..clusters * dim).map(|_| rng.next_range(-1.0, 1.0)).collect();
        let mut out = Vec::with_capacity(n * dim);
        for i in 0..n {
            let c = &centers[(i % clusters) * dim..(i % clusters + 1) * dim];
            let row: Vec<f32> = c.iter().map(|&v| v + rng.next_range(-0.6, 0.6)).collect();
            let inv = 1.0 / row.iter().map(|v| v * v).sum::<f32>().sqrt();
            out.extend(row.iter().map(|v| v * inv));
        }
        out
    }

    fn assert_equivalent(n: usize, dim: usize, k: usize, threshold: f32, seed: u32) {
        let v = embeddings(n, dim, 6, seed);
        let fast = cosine_knn_edges(&v, n, dim, k, threshold);
        let slow = reference_knn(&v, n, dim, k, threshold);
        assert_eq!(fast.len(), slow.len(), "n={n} dim={dim} k={k}");
        for (a, b) in fast.iter().zip(&slow) {
            assert_eq!((a.source(), a.target()), (b.source(), b.target()), "n={n} dim={dim} k={k}");
            assert!((a.weight() - b.weight()).abs() < 1e-5);
        }
    }

    #[test]
    fn matches_the_reference_implementation() {
        // dim not a multiple of 8 exercises the tail; n > 1600 exercises the strided scan
        for (n, dim, k, threshold, seed) in [
            (2, 3, 4, -1.0, 1),
            (60, 3, 5, 0.0, 2),
            (300, 37, 8, 0.2, 3),
            (900, 64, 6, -1.0, 4),
            (1700, 24, 10, 0.5, 5),
            (120, 1536, 12, 0.0, 6),
        ] {
            assert_equivalent(n, dim, k, threshold, seed);
        }
    }

    #[test]
    fn ties_keep_scan_order() {
        // Identical rows: every similarity ties, so neighbors are the first k scanned
        let v: Vec<f32> = (0..10).flat_map(|_| [1.0f32, 0.0, 0.0]).collect();
        let fast = cosine_knn_edges(&v, 10, 3, 3, 0.0);
        let slow = reference_knn(&v, 10, 3, 3, 0.0);
        let pairs = |e: &[EdgeData]| e.iter().map(|e| (e.source(), e.target())).collect::<Vec<_>>();
        assert_eq!(pairs(&fast), pairs(&slow));
        assert_eq!(pairs(&fast)[..3], [(0, 1), (0, 2), (0, 3)]);
    }

    /// `cargo test --release -p charturbo-core knn_timing -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn knn_timing_1000x1536() {
        let (n, dim) = (1000, 1536);
        let v = embeddings(n, dim, 8, 9);
        let time = |f: &dyn Fn() -> Vec<EdgeData>| {
            let t = std::time::Instant::now();
            let mut edges = 0;
            for _ in 0..3 {
                edges = f().len();
            }
            (t.elapsed().as_secs_f64() * 1000.0 / 3.0, edges)
        };
        let (old_ms, e_old) = time(&|| reference_knn(&v, n, dim, 10, 0.0));
        let (new_ms, e_new) = time(&|| cosine_knn_edges(&v, n, dim, 10, 0.0));
        assert_eq!(e_old, e_new);
        println!("knn 1000x1536 k=10: reference {old_ms:.1} ms, optimized {new_ms:.1} ms ({:.1}x)", old_ms / new_ms);
    }
}
