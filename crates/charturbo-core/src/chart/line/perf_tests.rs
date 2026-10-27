//! Equivalence tests of the optimized LineChart hot loops (`extents`, `push_m4`) against their
//! straightforward reference versions.

use super::{extents, push_m4};

/// Deterministic sample mix: walks, repeats, zeros, negatives, NaN and infinities.
fn samples(seed: u32, n: usize) -> Vec<f32> {
    let mut a = seed;
    let mut next = || {
        a = a.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        a >> 8
    };
    (0..n)
        .map(|_| match next() % 23 {
            0 => f32::NAN,
            1 => f32::INFINITY,
            2 => f32::NEG_INFINITY,
            3 => 0.0,
            4 => -0.0,
            5 => 7.0,
            k => (next() % 2001) as f32 / 10.0 - 100.0 + k as f32,
        })
        .collect()
}

fn reference_extents(values: &[f32]) -> ((f32, f32), (f32, f32)) {
    let fold = |pred: &dyn Fn(f32) -> bool| {
        values
            .iter()
            .copied()
            .filter(|&v| pred(v))
            .fold((f32::INFINITY, f32::NEG_INFINITY), |(lo, hi), v| (lo.min(v), hi.max(v)))
    };
    (fold(&|v| v.is_finite()), fold(&|v| v.is_finite() && v > 0.0))
}

fn reference_m4(values: &[f32], from: usize, to: usize, picks: &mut Vec<usize>, nan_zero: bool) {
    let (mut lo, mut hi) = (usize::MAX, usize::MAX);
    let val = |i: usize| if nan_zero && !values[i].is_finite() { 0.0 } else { values[i] };
    for i in from..to.min(values.len()) {
        let v = val(i);
        if !v.is_finite() {
            continue;
        }
        if lo == usize::MAX || v < val(lo) {
            lo = i;
        }
        if hi == usize::MAX || v > val(hi) {
            hi = i;
        }
    }
    let mut cand = [from, lo, hi, to - 1];
    cand.sort_unstable();
    for c in cand {
        if c != usize::MAX && picks.last() != Some(&c) {
            picks.push(c);
        }
    }
}

#[test]
fn one_pass_extents_match_the_reference_folds() {
    for seed in 0..40 {
        for n in [0, 1, 2, 5, 64, 1000] {
            let v = samples(seed, n);
            assert_eq!(extents(&v), reference_extents(&v), "seed {seed}, n {n}");
        }
    }
    // All negative / all non-finite: no positive extent
    assert_eq!(extents(&[-3.0, -1.0]).1, (f32::INFINITY, f32::NEG_INFINITY));
    assert_eq!(extents(&[f32::NAN, f32::INFINITY]), reference_extents(&[f32::NAN, f32::INFINITY]));
}

#[test]
fn register_m4_picks_match_the_reference() {
    for seed in 0..30 {
        let v = samples(seed, 997);
        for nan_zero in [false, true] {
            let (mut a, mut b) = (Vec::new(), Vec::new());
            // Buckets of every width, including ones past the end of the data
            let mut from = 0;
            let mut width = 1;
            while from < v.len() + 5 {
                let to = from + width;
                push_m4(&v, from, to, &mut a, nan_zero);
                reference_m4(&v, from, to, &mut b, nan_zero);
                from = to;
                width = width % 37 + 1;
            }
            assert_eq!(a, b, "seed {seed}, nan_zero {nan_zero}");
        }
    }
}
