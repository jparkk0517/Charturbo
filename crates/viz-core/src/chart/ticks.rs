//! "Nice" axis ticks (1 / 2 / 5 x 10^n), shared by every chart kind.

/// "Nice" tick step (1, 2, 5 x 10^n) giving about `target` intervals over `span`.
pub fn nice_step(span: f64, target: u32) -> f64 {
    let span = if span.is_finite() && span > 0.0 { span } else { 1.0 };
    let raw = span / target.max(1) as f64;
    let mag = 10f64.powf(raw.log10().floor());
    let norm = raw / mag;
    // Same thresholds as d3-array's tickIncrement (sqrt(2), sqrt(10), sqrt(50))
    let nice = if norm >= 50f64.sqrt() {
        10.0
    } else if norm >= 10f64.sqrt() {
        5.0
    } else if norm >= 2f64.sqrt() {
        2.0
    } else {
        1.0
    };
    nice * mag
}

/// Expands `[min, max]` outward to whole steps; returns `(nice_min, nice_max, step)`.
pub fn nice_domain(min: f64, max: f64, target: u32) -> (f64, f64, f64) {
    let (min, max) = if max > min { (min, max) } else { (min - 0.5, max + 0.5) };
    let step = nice_step(max - min, target);
    ((min / step).floor() * step, (max / step).ceil() * step, step)
}

/// Tick values `start, start + step, ...` within `[lo, hi]` (step-aligned, float-safe).
pub(crate) fn ticks_between(lo: f64, hi: f64, step: f64) -> Vec<f64> {
    if step.is_nan() || step <= 0.0 || !lo.is_finite() || !hi.is_finite() || hi < lo {
        return Vec::new();
    }
    // Domains round-trip through f32 (~1e-7 relative error): allow 1e-4 of a step
    let first = (lo / step - 1e-4).ceil() as i64;
    let last = (hi / step + 1e-4).floor() as i64;
    (first..=last.min(first + 1000))
        .map(|k| {
            let v = k as f64 * step;
            // Snap float noise (0.30000000000000004 -> 0.3)
            let digits = (-step.log10().floor()).max(0.0) as i32 + 2;
            let f = 10f64.powi(digits);
            (v * f).round() / f
        })
        .collect()
}
