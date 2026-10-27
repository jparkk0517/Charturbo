//! Time-axis ticks on UTC calendar boundaries (epoch milliseconds, no DST, no leap seconds).
//! Zoned axes (local / IANA time zones) reuse the interval ladder in time_zone.rs.
//!
//! Intervals follow the d3 time scale ladder: 1 / 2 / 5 / 10 / 15 / 30 s and min, 1 / 3 / 6 / 12 h,
//! 1 / 2 days, 1 week (Monday), 1 / 3 / 6 months, then 1 / 2 / 5 x 10^n years. Sub-second spans use
//! plain 1 / 2 / 5 x 10^n millisecond steps. Month / year steps use civil-date arithmetic.

use super::nice_step;

/// Granularity code of a tick (what label to show): the coarsest calendar boundary it lands on.
/// `0` is reserved for non-time ticks.
pub(crate) const GRAN_MILLISECOND: u8 = 1;
pub(crate) const GRAN_SECOND: u8 = 2;
pub(crate) const GRAN_MINUTE: u8 = 3;
pub(crate) const GRAN_HOUR: u8 = 4;
pub(crate) const GRAN_DAY: u8 = 5;
pub(crate) const GRAN_MONTH: u8 = 6;
pub(crate) const GRAN_YEAR: u8 = 7;

const SECOND: f64 = 1_000.0;
pub(super) const MINUTE: f64 = 60.0 * SECOND;
pub(super) const HOUR: f64 = 60.0 * MINUTE;
pub(super) const DAY: f64 = 24.0 * HOUR;
const WEEK: f64 = 7.0 * DAY;
const MONTH: f64 = 30.0 * DAY;
const YEAR: f64 = 365.0 * DAY;
/// Hard cap on emitted ticks (degenerate targets / spans)
pub(super) const MAX_TICKS: usize = 1000;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) enum Interval {
    /// Multiples of a fixed duration since the epoch (divides the parent unit, so UTC-aligned)
    Fixed(f64),
    /// Odd days of the month (1, 3, 5, ...), restarting each month
    TwoDays,
    /// UTC Mondays
    Week,
    Months(i64),
    Years(i64),
}

/// `(interval, approximate duration)` ascending, used to pick the step closest to the target.
const LADDER: [(Interval, f64); 23] = [
    (Interval::Fixed(SECOND), SECOND),
    (Interval::Fixed(2.0 * SECOND), 2.0 * SECOND),
    (Interval::Fixed(5.0 * SECOND), 5.0 * SECOND),
    (Interval::Fixed(10.0 * SECOND), 10.0 * SECOND),
    (Interval::Fixed(15.0 * SECOND), 15.0 * SECOND),
    (Interval::Fixed(30.0 * SECOND), 30.0 * SECOND),
    (Interval::Fixed(MINUTE), MINUTE),
    (Interval::Fixed(2.0 * MINUTE), 2.0 * MINUTE),
    (Interval::Fixed(5.0 * MINUTE), 5.0 * MINUTE),
    (Interval::Fixed(10.0 * MINUTE), 10.0 * MINUTE),
    (Interval::Fixed(15.0 * MINUTE), 15.0 * MINUTE),
    (Interval::Fixed(30.0 * MINUTE), 30.0 * MINUTE),
    (Interval::Fixed(HOUR), HOUR),
    (Interval::Fixed(3.0 * HOUR), 3.0 * HOUR),
    (Interval::Fixed(6.0 * HOUR), 6.0 * HOUR),
    (Interval::Fixed(12.0 * HOUR), 12.0 * HOUR),
    (Interval::Fixed(DAY), DAY),
    (Interval::TwoDays, 2.0 * DAY),
    (Interval::Week, WEEK),
    (Interval::Months(1), MONTH),
    (Interval::Months(3), 3.0 * MONTH),
    (Interval::Months(6), 6.0 * MONTH),
    (Interval::Years(1), YEAR),
];

/// Picks the calendar interval giving about `target` ticks over `span` ms.
pub(super) fn pick_interval(span: f64, target: u32) -> Interval {
    let raw = span / target.max(1) as f64;
    let i = LADDER.partition_point(|&(_, d)| d <= raw);
    if i == 0 {
        // Below a second: plain 1 / 2 / 5 x 10^n ms
        return Interval::Fixed(nice_step(span, target));
    }
    if i == LADDER.len() {
        let years = nice_step(span / YEAR, target).round().max(1.0);
        return Interval::Years(years as i64);
    }
    let (lo, lo_d) = LADDER[i - 1];
    let (hi, hi_d) = LADDER[i];
    // Closer in ratio (d3 tickInterval)
    if raw / lo_d < hi_d / raw {
        lo
    } else {
        hi
    }
}

/// Ticks within `[lo, hi]` (epoch ms) as `(value, granularity)`, about `target` of them.
pub(crate) fn time_ticks(lo: f64, hi: f64, target: u32) -> Vec<(f64, u8)> {
    if !lo.is_finite() || !hi.is_finite() || hi < lo {
        return Vec::new();
    }
    candidates(pick_interval(hi - lo, target), lo, hi)
        .into_iter()
        .filter(|&v| v >= lo && v <= hi)
        .take(MAX_TICKS)
        .map(|v| (v, granularity(v)))
        .collect()
}

/// Step-aligned values of `interval` around `[lo, hi]` (may overshoot by one step; the caller
/// filters). The values are wall-clock ms: UTC here, local time for zoned axes (time_zone.rs).
pub(super) fn candidates(interval: Interval, lo: f64, hi: f64) -> Vec<f64> {
    let mut vals: Vec<f64> = Vec::new();
    match interval {
        Interval::Fixed(step) => {
            if step.is_nan() || step <= 0.0 {
                return Vec::new();
            }
            let first = (lo / step).ceil() as i64;
            let last = (hi / step).floor() as i64;
            for k in first..=last.min(first + MAX_TICKS as i64) {
                vals.push(k as f64 * step);
            }
        }
        Interval::TwoDays => {
            let (d0, d1) = ((lo / DAY).floor() as i64, (hi / DAY).ceil() as i64);
            for d in d0..=d1.min(d0 + 2 * MAX_TICKS as i64) {
                let (y, m, dom) = civil_from_days(d);
                // Skip an odd last day (31st, Feb 29th) so the gap to the 1st stays >= 2 days
                if dom % 2 == 1 && dom < days_in_month(y, m) {
                    vals.push(d as f64 * DAY);
                }
            }
        }
        Interval::Week => {
            let mut d = (lo / DAY).ceil() as i64;
            // 1970-01-01 was a Thursday: Mondays are days with (d + 3) % 7 == 0
            d += (7 - (d + 3).rem_euclid(7)) % 7;
            let end = (hi / DAY).floor() as i64;
            while d <= end && vals.len() < MAX_TICKS {
                vals.push(d as f64 * DAY);
                d += 7;
            }
        }
        Interval::Months(n) => {
            let (y, m, _) = civil_from_days((lo / DAY).floor() as i64);
            let mut mi = y * 12 + (m as i64 - 1);
            if month_start_ms(mi) < lo {
                mi += 1;
            }
            mi += (n - mi.rem_euclid(n)) % n;
            while month_start_ms(mi) <= hi && vals.len() < MAX_TICKS {
                vals.push(month_start_ms(mi));
                mi += n;
            }
        }
        Interval::Years(n) => {
            let (mut y, _, _) = civil_from_days((lo / DAY).floor() as i64);
            if month_start_ms(y * 12) < lo {
                y += 1;
            }
            y += (n - y.rem_euclid(n)) % n;
            while month_start_ms(y * 12) <= hi && vals.len() < MAX_TICKS {
                vals.push(month_start_ms(y * 12));
                y += n;
            }
        }
    }
    vals
}

/// Coarsest UTC boundary `ms` lies on (year start, month start, midnight, hour, ...).
pub(crate) fn granularity(ms: f64) -> u8 {
    let day = (ms / DAY).floor();
    let rem = ms - day * DAY;
    if rem == 0.0 {
        let (_, m, d) = civil_from_days(day as i64);
        return match (m, d) {
            (1, 1) => GRAN_YEAR,
            (_, 1) => GRAN_MONTH,
            _ => GRAN_DAY,
        };
    }
    if rem % HOUR == 0.0 {
        GRAN_HOUR
    } else if rem % MINUTE == 0.0 {
        GRAN_MINUTE
    } else if rem % SECOND == 0.0 {
        GRAN_SECOND
    } else {
        GRAN_MILLISECOND
    }
}

/// Epoch ms of the first day of month index `mi` (= year * 12 + month0).
fn month_start_ms(mi: i64) -> f64 {
    days_from_civil(mi.div_euclid(12), (mi.rem_euclid(12) + 1) as u32, 1) as f64 * DAY
}

fn days_in_month(y: i64, m: u32) -> u32 {
    let mi = y * 12 + m as i64 - 1;
    let next = mi + 1;
    (days_from_civil(next.div_euclid(12), (next.rem_euclid(12) + 1) as u32, 1) - days_from_civil(y, m, 1)) as u32
}

/// Days since 1970-01-01 of a proleptic Gregorian date (H. Hinnant's `days_from_civil`).
pub(crate) fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m as i64 + 9) % 12; // March = 0
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// `(year, month 1-12, day 1-31)` of days since 1970-01-01.
pub(crate) fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utc(y: i64, m: u32, d: u32, h: u32, min: u32) -> f64 {
        days_from_civil(y, m, d) as f64 * DAY + h as f64 * HOUR + min as f64 * MINUTE
    }

    #[test]
    fn civil_date_round_trips() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2000, 3, 1), 11_017);
        assert_eq!(civil_from_days(-1), (1969, 12, 31));
        for z in (-800_000..800_000).step_by(37) {
            let (y, m, d) = civil_from_days(z);
            assert_eq!(days_from_civil(y, m, d), z);
        }
        assert_eq!(days_in_month(2024, 2), 29);
        assert_eq!(days_in_month(2100, 2), 28);
        assert_eq!(days_in_month(2026, 12), 31);
    }

    #[test]
    fn month_ticks_land_on_the_first_of_each_month() {
        // Mid-January to mid-July 2026, 6 ticks: monthly steps
        let ticks = time_ticks(utc(2026, 1, 15, 7, 30), utc(2026, 7, 14, 0, 0), 6);
        let expect: Vec<f64> = (2..=7).map(|m| utc(2026, m, 1, 0, 0)).collect();
        assert_eq!(ticks.iter().map(|t| t.0).collect::<Vec<_>>(), expect);
        assert!(ticks.iter().all(|t| t.1 == GRAN_MONTH));
        // Crossing a year: January 1st is reported as a year boundary
        let ticks = time_ticks(utc(2025, 10, 3, 0, 0), utc(2026, 3, 2, 0, 0), 5);
        assert_eq!(ticks.len(), 5);
        assert_eq!(ticks[2], (utc(2026, 1, 1, 0, 0), GRAN_YEAR));
        // Quarters align to Jan / Apr / Jul / Oct
        let ticks = time_ticks(utc(2024, 2, 1, 0, 0), utc(2026, 2, 1, 0, 0), 8);
        assert_eq!(ticks[0].0, utc(2024, 4, 1, 0, 0));
        assert_eq!(ticks[1].0, utc(2024, 7, 1, 0, 0));
    }

    #[test]
    fn sub_day_ticks_are_utc_aligned_and_mark_midnight_as_a_day() {
        // 2 days in ~8 ticks: 6-hour steps
        let ticks = time_ticks(utc(2026, 3, 1, 1, 0), utc(2026, 3, 3, 1, 0), 8);
        assert_eq!(ticks[0], (utc(2026, 3, 1, 6, 0), GRAN_HOUR));
        assert_eq!(ticks[3], (utc(2026, 3, 2, 0, 0), GRAN_DAY));
        assert!(ticks.windows(2).all(|w| w[1].0 - w[0].0 == 6.0 * HOUR));
        // 1 hour in ~4 ticks: 15-minute steps
        let ticks = time_ticks(utc(2026, 3, 1, 10, 5), utc(2026, 3, 1, 11, 5), 4);
        let mins: Vec<f64> = ticks.iter().map(|t| t.0).collect();
        assert_eq!(mins, vec![utc(2026, 3, 1, 10, 15), utc(2026, 3, 1, 10, 30), utc(2026, 3, 1, 10, 45), utc(2026, 3, 1, 11, 0)]);
        assert_eq!(ticks[0].1, GRAN_MINUTE);
        assert_eq!(ticks[3].1, GRAN_HOUR);
        // Sub-second span: plain ms steps
        let t0 = utc(2026, 3, 1, 0, 0) + 123.0;
        let ticks = time_ticks(t0, t0 + 50.0, 5);
        assert!(ticks.windows(2).all(|w| w[1].0 - w[0].0 == 10.0));
        assert_eq!(ticks[0], (t0 + 7.0, GRAN_MILLISECOND));
    }

    #[test]
    fn week_and_year_steps() {
        // 10 weeks in ~8 ticks: Mondays (2026-03-02 is a Monday)
        let ticks = time_ticks(utc(2026, 3, 1, 0, 0), utc(2026, 5, 10, 0, 0), 8);
        assert_eq!(ticks[0].0, utc(2026, 3, 2, 0, 0));
        assert!(ticks.windows(2).all(|w| w[1].0 - w[0].0 == WEEK));
        // 40 years in ~4 ticks: decades
        let ticks = time_ticks(utc(1983, 6, 1, 0, 0), utc(2024, 6, 1, 0, 0), 4);
        let years: Vec<i64> = ticks.iter().map(|t| civil_from_days((t.0 / DAY) as i64).0).collect();
        assert_eq!(years, vec![1990, 2000, 2010, 2020]);
        assert!(ticks.iter().all(|t| t.1 == GRAN_YEAR));
        // Two-day steps skip odd month ends (Jan 31st) so labels never touch
        let ticks = time_ticks(utc(2026, 1, 20, 0, 0), utc(2026, 2, 6, 0, 0), 8);
        let days: Vec<u32> = ticks.iter().map(|t| civil_from_days((t.0 / DAY) as i64).2).collect();
        assert_eq!(days, vec![21, 23, 25, 27, 29, 1, 3, 5]);
    }

    #[test]
    fn degenerate_inputs_are_empty_or_bounded() {
        assert!(time_ticks(f64::NAN, 1.0, 5).is_empty());
        assert!(time_ticks(10.0, 0.0, 5).is_empty());
        assert!(time_ticks(0.0, 1e15, 0).len() <= MAX_TICKS);
        assert_eq!(time_ticks(0.0, 0.0, 5), vec![(0.0, GRAN_YEAR)]);
    }
}
