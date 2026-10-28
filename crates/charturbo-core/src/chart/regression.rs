//! Least-squares regression of scatter trendlines (ECharts ecStat `regression`: linear,
//! exponential, logarithmic, polynomial). Fits run in data units, independent of the axis
//! scales; points outside a model's domain are counted, never folded in.

/// Highest polynomial order (Excel's polynomial trendline goes up to the sixth power).
pub const MAX_TREND_ORDER: u8 = 6;

/// Regression model of a trendline.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum TrendModel {
    /// `y = a + b x`
    Linear,
    /// `y = a e^(b x)`, fitted on `y > 0`
    Exponential,
    /// `y = a + b ln x`, fitted on `x > 0`
    Logarithmic,
    /// `y = c0 + c1 x + .. + ck x^k`, order `k` in `2..=MAX_TREND_ORDER`
    Polynomial(u8),
}

impl TrendModel {
    /// Model from its WASM code (0 linear, 1 exponential, 2 logarithmic, 3 polynomial; the
    /// order is clamped to `2..=MAX_TREND_ORDER`); `None` for unknown codes.
    pub fn from_code(code: u8, order: u8) -> Option<Self> {
        match code {
            0 => Some(Self::Linear),
            1 => Some(Self::Exponential),
            2 => Some(Self::Logarithmic),
            3 => Some(Self::Polynomial(order.clamp(2, MAX_TREND_ORDER))),
            _ => None,
        }
    }

    /// The point lies in the model's domain (finite; `y > 0` exponential; `x > 0` logarithmic).
    fn accepts(self, x: f64, y: f64) -> bool {
        match self {
            Self::Exponential => y > 0.0,
            Self::Logarithmic => x > 0.0,
            _ => true,
        }
    }
}

/// Result of a least-squares fit.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct TrendFit {
    /// Coefficients in data units: linear / logarithmic `[a, b]`, exponential `[a, b]`,
    /// polynomial `[c0, .., ck]` (ascending powers of x). Empty = no fit (too few points)
    pub coeffs: Vec<f64>,
    /// `1 - SS_res / SS_tot` of the fitted curve against the original y of the used points
    /// (NaN without a fit or when every y is equal)
    pub r2: f64,
    /// Points the fit used
    pub used: u32,
    /// Finite points outside the model's domain (`y <= 0` exponential, `x <= 0` logarithmic)
    pub skipped: u32,
    /// Polynomial: coefficients in `z = (x - center) / scale`, evaluated instead of `coeffs`
    /// (the power basis in raw x loses precision far from the origin)
    center: f64,
    scale: f64,
    z_coeffs: Vec<f64>,
}

impl TrendFit {
    /// Fitted y at `x` (NaN without a fit or outside the model's domain).
    pub fn eval(&self, model: TrendModel, x: f64) -> f64 {
        let c = &self.coeffs;
        if c.is_empty() {
            return f64::NAN;
        }
        match model {
            TrendModel::Linear => c[0] + c[1] * x,
            TrendModel::Exponential => c[0] * (c[1] * x).exp(),
            TrendModel::Logarithmic if x > 0.0 => c[0] + c[1] * x.ln(),
            TrendModel::Logarithmic => f64::NAN,
            TrendModel::Polynomial(_) => horner(&self.z_coeffs, (x - self.center) / self.scale),
        }
    }
}

fn horner(c: &[f64], z: f64) -> f64 {
    c.iter().rev().fold(0.0, |acc, &k| acc * z + k)
}

/// Weighted least-squares line `v = a + b u` through `(u, v, w)`, in centered form (two passes:
/// weighted means, then the centered cross products), so large offsets keep their precision.
/// `None` when the u values do not vary.
fn weighted_line(pts: &[(f64, f64, f64)]) -> Option<(f64, f64)> {
    let sw: f64 = pts.iter().map(|p| p.2).sum();
    if !(sw > 0.0) {
        return None;
    }
    let mu = pts.iter().map(|p| p.2 * p.0).sum::<f64>() / sw;
    let mv = pts.iter().map(|p| p.2 * p.1).sum::<f64>() / sw;
    let (mut suu, mut suv) = (0.0, 0.0);
    for &(u, v, w) in pts {
        suu += w * (u - mu) * (u - mu);
        suv += w * (u - mu) * (v - mv);
    }
    if !(suu > 0.0) {
        return None;
    }
    let b = suv / suu;
    Some((mv - b * mu, b))
}

/// Number of distinct values in `xs`, counted up to `limit`.
fn distinct_up_to(xs: impl Iterator<Item = f64>, limit: usize) -> usize {
    let mut seen: Vec<f64> = Vec::with_capacity(limit);
    for x in xs {
        if !seen.contains(&x) {
            seen.push(x);
            if seen.len() >= limit {
                break;
            }
        }
    }
    seen.len()
}

/// Polynomial least squares of order `k` in `z = (x - center) / scale` (z in [-1, 1]): Householder
/// would need the n x (k + 1) Vandermonde matrix; Givens rotations fold one row at a time into the
/// triangular factor R and Q^T y instead (Golub & Van Loan, Matrix Computations 4th ed., §5.1.8 /
/// §5.2.5 Givens QR), so memory stays O(k^2). Returns `(center, scale, z coefficients)`.
fn polynomial_z(pts: &[(f64, f64)], k: usize) -> Option<(f64, f64, Vec<f64>)> {
    let m = k + 1;
    // Full column rank of the Vandermonde matrix: at least k + 1 distinct x
    if distinct_up_to(pts.iter().map(|p| p.0), m) < m {
        return None;
    }
    let (lo, hi) = pts.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), p| (a.min(p.0), b.max(p.0)));
    let (center, scale) = ((lo + hi) * 0.5, (hi - lo) * 0.5);
    let mut r = vec![0.0f64; m * m];
    let mut qty = vec![0.0f64; m];
    let mut row = vec![0.0f64; m];
    for &(x, y) in pts {
        let z = (x - center) / scale;
        let mut p = 1.0;
        for v in row.iter_mut() {
            *v = p;
            p *= z;
        }
        let mut rhs = y;
        for j in 0..m {
            let a = row[j];
            if a == 0.0 {
                continue;
            }
            let d = r[j * m + j];
            let h = d.hypot(a);
            let (c, s) = (d / h, a / h);
            r[j * m + j] = h;
            for l in j + 1..m {
                let (rl, xl) = (r[j * m + l], row[l]);
                r[j * m + l] = c * rl + s * xl;
                row[l] = c * xl - s * rl;
            }
            let q = qty[j];
            qty[j] = c * q + s * rhs;
            rhs = c * rhs - s * q;
        }
    }
    // Back substitution R c = Q^T y
    let mut coef = vec![0.0; m];
    for j in (0..m).rev() {
        let mut v = qty[j];
        for l in j + 1..m {
            v -= r[j * m + l] * coef[l];
        }
        let d = r[j * m + j];
        if d == 0.0 {
            return None;
        }
        coef[j] = v / d;
    }
    coef.iter().all(|c| c.is_finite()).then_some((center, scale, coef))
}

/// Power-basis coefficients in x of `sum_j zc[j] ((x - center) / scale)^j` (binomial expansion).
fn expand_z(zc: &[f64], center: f64, scale: f64) -> Vec<f64> {
    let m = zc.len();
    let mut out = vec![0.0; m];
    for (j, &cj) in zc.iter().enumerate() {
        let f = cj / scale.powi(j as i32);
        // (x - center)^j = sum_i C(j, i) x^i (-center)^(j - i)
        let mut binom = 1.0;
        for i in 0..=j {
            out[i] += f * binom * (-center).powi((j - i) as i32);
            binom = binom * (j - i) as f64 / (i + 1) as f64;
        }
    }
    out
}

/// Fits `model` to the finite `(x, y)` points by least squares:
/// - linear: ordinary least squares;
/// - polynomial: least squares in the centered / scaled basis (Givens QR, see `polynomial_z`);
/// - exponential: ecStat's log-linear fit of `ln y = ln a + b x` weighted by `y` (minimizes
///   `sum y (ln y - ln a - b x)^2`, Weisstein, "Least Squares Fitting--Exponential", MathWorld,
///   eqs. 9-10), on `y > 0`;
/// - logarithmic: ordinary least squares of `y` on `ln x` (MathWorld "Least Squares
///   Fitting--Logarithmic"), on `x > 0`.
///
/// R² is the coefficient of determination `1 - sum (y - ŷ)^2 / sum (y - ȳ)^2` (Weisstein,
/// "Coefficient of Determination", MathWorld) on the original y of the used points, for every
/// model: for the exponential fit it measures the curve in y, not the linearized `ln y`
/// regression. ecStat itself reports no R².
pub fn fit_trend(model: TrendModel, pts: impl Iterator<Item = (f64, f64)>) -> TrendFit {
    let mut used: Vec<(f64, f64)> = Vec::new();
    let mut skipped = 0u32;
    for (x, y) in pts.filter(|(x, y)| x.is_finite() && y.is_finite()) {
        if model.accepts(x, y) {
            used.push((x, y));
        } else {
            skipped += 1;
        }
    }
    let mut fit = TrendFit { r2: f64::NAN, used: used.len() as u32, skipped, scale: 1.0, ..Default::default() };
    let coeffs = match model {
        TrendModel::Linear => {
            let pts: Vec<(f64, f64, f64)> = used.iter().map(|&(x, y)| (x, y, 1.0)).collect();
            weighted_line(&pts).map(|(a, b)| vec![a, b])
        }
        TrendModel::Logarithmic => {
            let pts: Vec<(f64, f64, f64)> = used.iter().map(|&(x, y)| (x.ln(), y, 1.0)).collect();
            weighted_line(&pts).map(|(a, b)| vec![a, b])
        }
        TrendModel::Exponential => {
            let pts: Vec<(f64, f64, f64)> = used.iter().map(|&(x, y)| (x, y.ln(), y)).collect();
            weighted_line(&pts).map(|(ln_a, b)| vec![ln_a.exp(), b])
        }
        TrendModel::Polynomial(k) => polynomial_z(&used, k.clamp(2, MAX_TREND_ORDER) as usize).map(|(center, scale, zc)| {
            (fit.center, fit.scale) = (center, scale);
            let c = expand_z(&zc, center, scale);
            fit.z_coeffs = zc;
            c
        }),
    };
    let Some(coeffs) = coeffs.filter(|c| c.iter().all(|v| v.is_finite())) else {
        fit.z_coeffs.clear();
        return fit;
    };
    fit.coeffs = coeffs;
    let mean = used.iter().map(|p| p.1).sum::<f64>() / used.len() as f64;
    let (mut ss_res, mut ss_tot) = (0.0, 0.0);
    for &(x, y) in &used {
        ss_res += (y - fit.eval(model, x)).powi(2);
        ss_tot += (y - mean).powi(2);
    }
    fit.r2 = if ss_tot > 0.0 { 1.0 - ss_res / ss_tot } else { f64::NAN };
    fit
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pts<'a>(xs: &'a [f64], ys: &'a [f64]) -> impl Iterator<Item = (f64, f64)> + 'a {
        xs.iter().copied().zip(ys.iter().copied())
    }

    fn close(a: f64, b: f64, tol: f64) -> bool {
        (a - b).abs() <= tol * b.abs().max(1.0)
    }

    #[test]
    fn linear_is_ordinary_least_squares_with_r_squared() {
        // Textbook data: b = 0.6, a = 2.2, SS_res = 2.4, SS_tot = 6 -> R² = 0.6
        let fit = fit_trend(TrendModel::Linear, pts(&[1.0, 2.0, 3.0, 4.0, 5.0], &[2.0, 4.0, 5.0, 4.0, 5.0]));
        assert!(close(fit.coeffs[0], 2.2, 1e-12) && close(fit.coeffs[1], 0.6, 1e-12), "{:?}", fit.coeffs);
        assert!(close(fit.r2, 0.6, 1e-12), "{}", fit.r2);
        assert_eq!((fit.used, fit.skipped), (5, 0));
        // Non-finite points are not data: neither used nor skipped
        let fit = fit_trend(TrendModel::Linear, pts(&[1.0, f64::NAN, 2.0], &[1.0, 5.0, 3.0]));
        assert_eq!((fit.used, fit.skipped), (2, 0));
        assert!(close(fit.coeffs[1], 2.0, 1e-12));
        // Large x offsets (timestamps) keep their precision
        let xs: Vec<f64> = (0..50).map(|i| 1.7e12 + i as f64 * 60_000.0).collect();
        let ys: Vec<f64> = xs.iter().map(|x| 3.0 + (x - 1.7e12) * 1e-4).collect();
        let fit = fit_trend(TrendModel::Linear, pts(&xs, &ys));
        assert!(close(fit.coeffs[1], 1e-4, 1e-9) && close(fit.r2, 1.0, 1e-9), "{fit:?}");
        // One distinct x: no fit
        let fit = fit_trend(TrendModel::Linear, pts(&[2.0, 2.0], &[1.0, 3.0]));
        assert!(fit.coeffs.is_empty() && fit.r2.is_nan() && fit.eval(TrendModel::Linear, 1.0).is_nan());
    }

    #[test]
    fn polynomial_recovers_exact_coefficients_and_stays_stable_off_origin() {
        let xs: Vec<f64> = (0..41).map(|i| -3.0 + i as f64 * 0.15).collect();
        let f = |x: f64| 1.0 + 2.0 * x - 0.5 * x * x + 0.25 * x * x * x;
        let ys: Vec<f64> = xs.iter().map(|&x| f(x)).collect();
        let fit = fit_trend(TrendModel::Polynomial(3), pts(&xs, &ys));
        for (got, want) in fit.coeffs.iter().zip([1.0, 2.0, -0.5, 0.25]) {
            assert!(close(*got, want, 1e-10), "{:?}", fit.coeffs);
        }
        assert!(close(fit.r2, 1.0, 1e-12));
        // Order 6 far from the origin: the raw normal equations would be hopeless (x^12 ~ 1e72)
        let xs: Vec<f64> = (0..200).map(|i| 1e6 + i as f64).collect();
        let g = |x: f64| {
            let d = (x - 1e6 - 100.0) / 100.0;
            5.0 + d - 2.0 * d.powi(2) + 0.5 * d.powi(4) - 0.1 * d.powi(6)
        };
        let ys: Vec<f64> = xs.iter().map(|&x| g(x)).collect();
        let fit = fit_trend(TrendModel::Polynomial(6), pts(&xs, &ys));
        for &x in &[1e6, 1e6 + 37.0, 1e6 + 199.0] {
            assert!(close(fit.eval(TrendModel::Polynomial(6), x), g(x), 1e-8), "at {x}");
        }
        assert!(close(fit.r2, 1.0, 1e-9), "{}", fit.r2);
        // Fewer distinct x than coefficients: no fit; orders beyond the cap are clamped
        assert!(fit_trend(TrendModel::Polynomial(2), pts(&[0.0, 1.0, 1.0], &[1.0, 2.0, 3.0])).coeffs.is_empty());
        let xs: Vec<f64> = (0..20).map(f64::from).collect();
        assert_eq!(fit_trend(TrendModel::Polynomial(9), pts(&xs, &xs)).coeffs.len(), 7);
    }

    #[test]
    fn exponential_is_ecstat_y_weighted_log_fit_on_positive_y() {
        // Exact data: every weighting recovers y = 2 e^(0.3 x)
        let xs: Vec<f64> = (0..10).map(f64::from).collect();
        let ys: Vec<f64> = xs.iter().map(|x| 2.0 * (0.3 * x).exp()).collect();
        let fit = fit_trend(TrendModel::Exponential, pts(&xs, &ys));
        assert!(close(fit.coeffs[0], 2.0, 1e-10) && close(fit.coeffs[1], 0.3, 1e-10), "{:?}", fit.coeffs);
        // Noisy data against ecStat's raw sums (MathWorld eqs. 9-10)
        let xs = [0.0, 1.0, 2.0, 3.0, 4.0, 5.0];
        let ys = [1.1, 2.3, 3.9, 8.5, 15.2, 33.0];
        let (mut sy, mut sxy, mut sxxy, mut sylny, mut sxylny) = (0.0, 0.0, 0.0, 0.0, 0.0);
        for (&x, &y) in xs.iter().zip(&ys) {
            sy += y;
            sxy += x * y;
            sxxy += x * x * y;
            sylny += y * f64::ln(y);
            sxylny += x * y * f64::ln(y);
        }
        let den = sy * sxxy - sxy * sxy;
        let a = ((sxxy * sylny - sxy * sxylny) / den).exp();
        let b = (sy * sxylny - sxy * sylny) / den;
        let fit = fit_trend(TrendModel::Exponential, pts(&xs, &ys));
        assert!(close(fit.coeffs[0], a, 1e-10) && close(fit.coeffs[1], b, 1e-10), "{:?} vs {a} {b}", fit.coeffs);
        // R² on the original y
        let mean = ys.iter().sum::<f64>() / 6.0;
        let ss_res: f64 = xs.iter().zip(&ys).map(|(&x, &y)| (y - a * (b * x).exp()).powi(2)).sum();
        let ss_tot: f64 = ys.iter().map(|y| (y - mean).powi(2)).sum();
        assert!(close(fit.r2, 1.0 - ss_res / ss_tot, 1e-10), "{}", fit.r2);
        // y <= 0 is outside the domain: counted, not used
        let fit = fit_trend(TrendModel::Exponential, pts(&[0.0, 1.0, 2.0, 3.0], &[1.0, 0.0, -4.0, 8.0]));
        assert_eq!((fit.used, fit.skipped), (2, 2));
        assert!(close(fit.coeffs[1], 8f64.ln() / 3.0, 1e-12));
    }

    #[test]
    fn logarithmic_is_least_squares_on_ln_x_for_positive_x() {
        let xs: Vec<f64> = (1..30).map(|i| i as f64 * 0.7).collect();
        let ys: Vec<f64> = xs.iter().map(|x| 1.5 + 2.0 * x.ln()).collect();
        let mut all_x = xs.clone();
        let mut all_y = ys.clone();
        all_x.extend([0.0, -2.0]);
        all_y.extend([9.0, 9.0]);
        let fit = fit_trend(TrendModel::Logarithmic, pts(&all_x, &all_y));
        assert!(close(fit.coeffs[0], 1.5, 1e-10) && close(fit.coeffs[1], 2.0, 1e-10), "{:?}", fit.coeffs);
        assert_eq!((fit.used, fit.skipped), (29, 2));
        assert!(close(fit.r2, 1.0, 1e-12));
        assert!(fit.eval(TrendModel::Logarithmic, -1.0).is_nan());
        // ecStat's normal equations on noisy data
        let (xs, ys) = ([1.0, 2.0, 4.0, 8.0, 16.0], [0.5, 2.1, 2.9, 4.2, 4.8]);
        let n = 5.0;
        let (mut sl, mut syl, mut sy, mut sll) = (0.0, 0.0, 0.0, 0.0);
        for (&x, &y) in xs.iter().zip(&ys) {
            let l = f64::ln(x);
            (sl, syl, sy, sll) = (sl + l, syl + y * l, sy + y, sll + l * l);
        }
        let b = (n * syl - sy * sl) / (n * sll - sl * sl);
        let a = (sy - b * sl) / n;
        let fit = fit_trend(TrendModel::Logarithmic, pts(&xs, &ys));
        assert!(close(fit.coeffs[0], a, 1e-12) && close(fit.coeffs[1], b, 1e-12));
    }

    #[test]
    fn model_codes_and_constant_y() {
        assert_eq!(TrendModel::from_code(3, 9), Some(TrendModel::Polynomial(6)));
        assert_eq!(TrendModel::from_code(3, 0), Some(TrendModel::Polynomial(2)));
        assert_eq!(TrendModel::from_code(1, 0), Some(TrendModel::Exponential));
        assert_eq!(TrendModel::from_code(7, 0), None);
        // Every y equal: the line fits, R² is undefined
        let fit = fit_trend(TrendModel::Linear, pts(&[0.0, 1.0, 2.0], &[4.0, 4.0, 4.0]));
        assert_eq!(fit.coeffs, vec![4.0, 0.0]);
        assert!(fit.r2.is_nan());
    }
}
