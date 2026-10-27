//! Min / max of values already known to be non-NaN (data passed an `is_finite` check, or
//! infinite fold seeds). `f32::min` / `max` must ignore NaN operands, which the wasm32 backend
//! lowers to a libm call per comparison; on these hot per-sample loops a plain compare-select is
//! 2-3x faster with identical results.

#[inline(always)]
pub(crate) fn min_f32(a: f32, b: f32) -> f32 {
    if b < a {
        b
    } else {
        a
    }
}

#[inline(always)]
pub(crate) fn max_f32(a: f32, b: f32) -> f32 {
    if b > a {
        b
    } else {
        a
    }
}

#[inline(always)]
pub(crate) fn min_f64(a: f64, b: f64) -> f64 {
    if b < a {
        b
    } else {
        a
    }
}

#[inline(always)]
pub(crate) fn max_f64(a: f64, b: f64) -> f64 {
    if b > a {
        b
    } else {
        a
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn match_std_min_max_on_non_nan_values() {
        let vals = [f32::NEG_INFINITY, -3.5, -0.0, 0.0, 1.0, 2.5, f32::INFINITY];
        for &a in &vals {
            for &b in &vals {
                assert_eq!(min_f32(a, b), a.min(b), "{a} {b}");
                assert_eq!(max_f32(a, b), a.max(b), "{a} {b}");
                assert_eq!(min_f64(a as f64, b as f64), (a as f64).min(b as f64));
                assert_eq!(max_f64(a as f64, b as f64), (a as f64).max(b as f64));
            }
        }
    }
}
