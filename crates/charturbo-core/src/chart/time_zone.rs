//! Time zone of time axes: a compact UTC-offset transition table supplied by the SDK (wasm has
//! no tz database; the SDK derives the table from `Intl.DateTimeFormat` for the data domain).
//!
//! Ticks land on local wall-clock boundaries: sub-day steps are aligned per constant-offset
//! segment (so a 23 h / 25 h DST day keeps every real hour tick and +05:30 / +05:45 zones get
//! local hours), day and longer steps are generated as local civil dates and mapped back to UTC
//! (a wall time inside a spring-forward gap resolves past the gap, like JS `Date`). The empty
//! table is UTC and takes the plain `time_ticks` path (zero cost).

use super::area::AreaChart;
use super::time_ticks::{candidates, granularity, pick_interval, time_ticks, Interval, DAY, MAX_TICKS, MINUTE};
use super::{ChartKind, ChartState, LineXKind};

/// Largest accepted UTC offset (real zones stay within -12 h .. +14 h)
const MAX_OFFSET_MIN: f32 = 24.0 * 60.0;

/// UTC offsets by instant: `offsets_ms[i]` applies from `transitions[i]` (UTC ms) until the next
/// transition; `offsets_ms[0]` also applies before `transitions[0]`, the last one after the end.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct TimeZone {
    transitions: Vec<f64>,
    offsets_ms: Vec<f64>,
}

impl TimeZone {
    /// Table from parallel arrays: strictly ascending transition instants (UTC ms, the first may
    /// be `-inf`) and the offset in minutes (east of UTC positive) in effect from each. Empty =
    /// UTC. A table whose offsets are all 0 is stored as UTC.
    pub fn from_table(transitions_ms: &[f64], offsets_min: &[f32]) -> Result<Self, String> {
        if transitions_ms.len() != offsets_min.len() {
            return Err(format!(
                "time zone: {} transitions for {} offsets",
                transitions_ms.len(),
                offsets_min.len()
            ));
        }
        if transitions_ms.iter().any(|t| t.is_nan()) || transitions_ms.windows(2).any(|w| w[1] <= w[0]) {
            return Err("time zone: transitions must be ascending numbers".into());
        }
        if offsets_min.iter().any(|o| !o.is_finite() || o.abs() > MAX_OFFSET_MIN) {
            return Err("time zone: offsets must be finite minutes within +-24 h".into());
        }
        if offsets_min.iter().all(|&o| o == 0.0) {
            return Ok(Self::default());
        }
        Ok(Self {
            transitions: transitions_ms.to_vec(),
            offsets_ms: offsets_min.iter().map(|&o| o as f64 * MINUTE).collect(),
        })
    }

    /// No offsets: plain UTC.
    pub fn is_utc(&self) -> bool {
        self.offsets_ms.is_empty()
    }

    /// Index of the constant-offset segment containing `utc` (0 when the table is empty).
    fn segment(&self, utc: f64) -> usize {
        self.transitions.partition_point(|&t| t <= utc).saturating_sub(1)
    }

    /// UTC offset in effect at instant `utc`, in ms.
    pub fn offset_ms(&self, utc: f64) -> f64 {
        self.offsets_ms.get(self.segment(utc)).copied().unwrap_or(0.0)
    }

    /// Local wall-clock ms ("epoch ms as if the zone were UTC") of instant `utc`.
    pub fn to_local(&self, utc: f64) -> f64 {
        utc + self.offset_ms(utc)
    }

    /// Instant of local wall-clock ms `wall`: the earlier one when the wall time repeats (fall
    /// back), and past the gap when it does not exist (spring forward: 02:30 -> 03:30).
    pub fn to_utc(&self, wall: f64) -> f64 {
        if self.is_utc() {
            return wall;
        }
        // Offsets are within +-24 h: segments in effect a day either side bracket every candidate
        let (s0, s1) = (self.segment(wall - DAY), self.segment(wall + DAY));
        let mut best: Option<f64> = None;
        for k in s0..=s1 {
            let t = wall - self.offsets_ms[k];
            if self.segment(t) == k {
                best = Some(best.map_or(t, |b: f64| b.min(t)));
            }
        }
        if let Some(t) = best {
            return t;
        }
        // In a gap between segments k - 1 and k: keep the earlier offset (lands after the jump)
        for k in s0 + 1..=s1 {
            let tr = self.transitions[k];
            if wall - self.offsets_ms[k - 1] >= tr && wall - self.offsets_ms[k] < tr {
                return wall - self.offsets_ms[k - 1];
            }
        }
        wall - self.offset_ms(wall)
    }
}

/// `time_ticks` in zone `tz`: ticks within `[lo, hi]` (UTC epoch ms) on local calendar / clock
/// boundaries, with the granularity of the local wall time.
pub(crate) fn time_ticks_tz(lo: f64, hi: f64, target: u32, tz: &TimeZone) -> Vec<(f64, u8)> {
    if tz.is_utc() {
        return time_ticks(lo, hi, target);
    }
    if !lo.is_finite() || !hi.is_finite() || hi < lo {
        return Vec::new();
    }
    let mut vals = match pick_interval(hi - lo, target) {
        Interval::Fixed(step) if step < DAY => fixed_ticks(lo, hi, step, tz),
        interval => {
            // Local civil boundaries (midnight, Monday, month / year start) mapped back to UTC
            let (w0, w1) = (tz.to_local(lo), tz.to_local(hi));
            candidates(interval, w0 - DAY, w1 + DAY)
                .into_iter()
                .map(|w| tz.to_utc(w))
                .filter(|&v| v >= lo && v <= hi)
                .collect()
        }
    };
    vals.dedup();
    vals.into_iter().take(MAX_TICKS).map(|v| (v, granularity(tz.to_local(v)))).collect()
}

/// Multiples of a sub-day `step` of local wall-clock time within `[lo, hi]`: aligned per
/// constant-offset segment, so repeated hours (fall back) get both ticks and skipped ones none.
fn fixed_ticks(lo: f64, hi: f64, step: f64, tz: &TimeZone) -> Vec<f64> {
    let mut vals = Vec::new();
    if step.is_nan() || step <= 0.0 {
        return vals;
    }
    let (s0, s1) = (tz.segment(lo), tz.segment(hi));
    for k in s0..=s1 {
        // Segment k clipped to the range: [a, b), closed at `hi` for the last one
        let a = if k == s0 { lo } else { tz.transitions[k] };
        let b = if k == s1 { hi } else { tz.transitions[k + 1] };
        let off = tz.offsets_ms[k];
        let first = ((a + off) / step).ceil() as i64;
        let last = ((b + off) / step).floor() as i64;
        for n in first..=last {
            let t = n as f64 * step - off;
            if t < a || t > hi || (k != s1 && t >= b) {
                continue;
            }
            vals.push(t);
            if vals.len() >= MAX_TICKS {
                return vals;
            }
        }
    }
    vals
}

impl ChartState {
    /// Time zone of the time x axis (line / area / candlestick with `x_kind` time). Ticks are
    /// re-laid out; data, zoom window, and hover are unaffected.
    pub fn set_time_zone(&mut self, tz: TimeZone) {
        if self.time_zone != tz {
            self.time_zone = tz;
            self.axes_key = None;
        }
    }

    pub fn time_zone(&self) -> &TimeZone {
        &self.time_zone
    }

    /// Full x domain `[lo, hi]` (epoch ms) of a time x axis, `None` otherwise: the SDK keeps
    /// the offset table covering it (zoom / pan never leave the domain; streaming extends it).
    pub fn time_x_domain(&self) -> Option<(f64, f64)> {
        match &self.kind {
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. })
                if l.has_x() && !l.x_log && l.layout.x_kind == LineXKind::Time =>
            {
                Some((l.x_abs_to_data(l.x_min), l.x_abs_to_data(l.x_min + l.x_span)))
            }
            ChartKind::Candle(c) if c.has_t && c.layout.x_kind == LineXKind::Time => Some(c.x_domain()),
            ChartKind::Combo(c) if !c.categorical && c.line.layout.x_kind == LineXKind::Time => {
                Some((c.line.x_min, c.line.x_min + c.line.x_span))
            }
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::time_ticks::{days_from_civil, GRAN_DAY, GRAN_HOUR, GRAN_MINUTE, GRAN_MONTH, GRAN_YEAR, HOUR};
    use super::*;

    fn utc(y: i64, m: u32, d: u32, h: u32, min: u32) -> f64 {
        days_from_civil(y, m, d) as f64 * DAY + h as f64 * HOUR + min as f64 * MINUTE
    }

    /// America/New_York 2026: EST (-5 h) until Mar 8 07:00 UTC, EDT (-4 h) until Nov 1 06:00 UTC
    fn new_york() -> TimeZone {
        TimeZone::from_table(
            &[f64::NEG_INFINITY, utc(2026, 3, 8, 7, 0), utc(2026, 11, 1, 6, 0)],
            &[-300.0, -240.0, -300.0],
        )
        .unwrap()
    }

    /// Europe/Berlin 2026: CET (+1 h) until Mar 29 01:00 UTC, CEST (+2 h) until Oct 25 01:00 UTC
    fn berlin() -> TimeZone {
        TimeZone::from_table(&[f64::NEG_INFINITY, utc(2026, 3, 29, 1, 0), utc(2026, 10, 25, 1, 0)], &[60.0, 120.0, 60.0])
            .unwrap()
    }

    fn fixed(min: f32) -> TimeZone {
        TimeZone::from_table(&[f64::NEG_INFINITY], &[min]).unwrap()
    }

    /// Local wall times `(day, hour, minute)` of tick values.
    fn walls(tz: &TimeZone, ticks: &[(f64, u8)]) -> Vec<(u32, u32, u32)> {
        ticks
            .iter()
            .map(|&(t, _)| {
                let w = tz.to_local(t);
                let day = (w / DAY).floor();
                let (_, _, d) = super::super::time_ticks::civil_from_days(day as i64);
                let rem = w - day * DAY;
                (d, (rem / HOUR) as u32, ((rem % HOUR) / MINUTE) as u32)
            })
            .collect()
    }

    #[test]
    fn table_validation_and_utc_fast_path() {
        assert!(TimeZone::from_table(&[], &[]).unwrap().is_utc());
        assert!(TimeZone::from_table(&[0.0], &[0.0]).unwrap().is_utc());
        assert!(TimeZone::from_table(&[0.0], &[]).is_err());
        assert!(TimeZone::from_table(&[5.0, 5.0], &[60.0, 120.0]).is_err());
        assert!(TimeZone::from_table(&[f64::NAN], &[60.0]).is_err());
        assert!(TimeZone::from_table(&[0.0], &[f32::NAN]).is_err());
        assert!(TimeZone::from_table(&[0.0], &[2000.0]).is_err());
        // UTC zone = the plain tick generator, bit for bit
        let (lo, hi) = (utc(2026, 1, 15, 7, 30), utc(2026, 7, 14, 0, 0));
        for target in [3, 6, 12, 40, 400] {
            assert_eq!(time_ticks_tz(lo, hi, target, &TimeZone::default()), time_ticks(lo, hi, target));
        }
    }

    #[test]
    fn utc_local_round_trip_with_gap_and_overlap() {
        let ny = new_york();
        assert_eq!(ny.offset_ms(utc(2026, 1, 1, 0, 0)), -5.0 * HOUR);
        assert_eq!(ny.offset_ms(utc(2026, 7, 1, 0, 0)), -4.0 * HOUR);
        // 2026-03-08 01:30 EST exists; 02:30 does not (resolves to 03:30 EDT = 07:30 UTC)
        assert_eq!(ny.to_utc(utc(2026, 3, 8, 1, 30)), utc(2026, 3, 8, 6, 30));
        assert_eq!(ny.to_utc(utc(2026, 3, 8, 2, 30)), utc(2026, 3, 8, 7, 30));
        assert_eq!(ny.to_utc(utc(2026, 3, 8, 3, 0)), utc(2026, 3, 8, 7, 0));
        // 2026-11-01 01:30 happens twice: the earlier (EDT) instant
        assert_eq!(ny.to_utc(utc(2026, 11, 1, 1, 30)), utc(2026, 11, 1, 5, 30));
        for t in (0..400).map(|k| utc(2026, 1, 1, 0, 0) + k as f64 * 21.7 * HOUR) {
            assert!(ny.to_utc(ny.to_local(t)) <= t);
            assert_eq!(ny.to_local(ny.to_utc(ny.to_local(t))), ny.to_local(t));
        }
    }

    #[test]
    fn new_york_dst_days_keep_local_hour_ticks() {
        let ny = new_york();
        // Spring forward: 23 h day, hourly ticks skip the missing 02:00
        let ticks = time_ticks_tz(utc(2026, 3, 8, 5, 0), utc(2026, 3, 8, 9, 0), 4, &ny);
        assert_eq!(walls(&ny, &ticks), vec![(8, 0, 0), (8, 1, 0), (8, 3, 0), (8, 4, 0), (8, 5, 0)]);
        assert_eq!(ticks[0].1, GRAN_DAY);
        assert!(ticks[1..].iter().all(|t| t.1 == GRAN_HOUR));
        assert!(ticks.windows(2).all(|w| w[1].0 - w[0].0 == HOUR));
        // Fall back: 25 h day, 01:00 shows twice (EDT then EST), an hour apart
        let ticks = time_ticks_tz(utc(2026, 11, 1, 4, 0), utc(2026, 11, 1, 8, 0), 4, &ny);
        assert_eq!(walls(&ny, &ticks), vec![(1, 0, 0), (1, 1, 0), (1, 1, 0), (1, 2, 0), (1, 3, 0)]);
        assert!(ticks.windows(2).all(|w| w[1].0 - w[0].0 == HOUR));
        // 6-hour steps across the 23 h day stay on local 00 / 06 / 12 / 18
        let ticks = time_ticks_tz(utc(2026, 3, 7, 12, 0), utc(2026, 3, 9, 12, 0), 8, &ny);
        assert!(walls(&ny, &ticks).iter().all(|&(_, h, m)| h % 6 == 0 && m == 0));
        assert!(ticks.iter().any(|&(t, _)| t == utc(2026, 3, 8, 5, 0)));
        assert!(ticks.iter().any(|&(t, _)| t == utc(2026, 3, 9, 4, 0)), "midnight after the switch is EDT");
    }

    #[test]
    fn day_ticks_land_on_local_midnight_across_dst() {
        for (tz, spring, fall) in [(new_york(), (3, 8), (11, 1)), (berlin(), (3, 29), (10, 25))] {
            for (m, d) in [spring, fall] {
                let (lo, hi) = (utc(2026, m, d, 0, 0) - 4.0 * DAY, utc(2026, m, d, 0, 0) + 4.0 * DAY);
                let ticks = time_ticks_tz(lo, hi, 8, &tz);
                assert!(ticks.len() >= 7);
                for &(t, g) in &ticks {
                    assert_eq!(tz.to_local(t).rem_euclid(DAY), 0.0, "local midnight");
                    assert!(g >= GRAN_DAY);
                }
                // One day is 23 h or 25 h long
                let gaps: Vec<f64> = ticks.windows(2).map(|w| w[1].0 - w[0].0).collect();
                assert!(gaps.iter().any(|&g| g == 23.0 * HOUR || g == 25.0 * HOUR));
            }
        }
        // Berlin spring: Mar 29 00:00 CET = Mar 28 23:00 UTC; Mar 30 00:00 CEST = Mar 29 22:00 UTC
        let be = berlin();
        let ticks = time_ticks_tz(utc(2026, 3, 27, 0, 0), utc(2026, 4, 2, 0, 0), 6, &be);
        assert!(ticks.iter().any(|&(t, _)| t == utc(2026, 3, 28, 23, 0)));
        assert!(ticks.iter().any(|&(t, _)| t == utc(2026, 3, 29, 22, 0)));
    }

    #[test]
    fn half_and_quarter_hour_offsets_get_local_hour_ticks() {
        // Asia/Kolkata (+05:30) and Asia/Kathmandu (+05:45): hourly ticks on local hh:00
        for min in [330.0, 345.0] {
            let tz = fixed(min);
            let ticks = time_ticks_tz(utc(2026, 6, 1, 0, 0), utc(2026, 6, 1, 6, 0), 6, &tz);
            assert!(ticks.len() >= 5);
            assert!(walls(&tz, &ticks).iter().all(|&(_, _, m)| m == 0));
            assert!(ticks.windows(2).all(|w| w[1].0 - w[0].0 == HOUR));
            // Local midnight (Jun 2 00:00) is a day boundary
            let ticks = time_ticks_tz(utc(2026, 6, 1, 12, 0), utc(2026, 6, 2, 0, 0), 6, &tz);
            let midnight = utc(2026, 6, 2, 0, 0) - min as f64 * MINUTE;
            assert!(ticks.contains(&(midnight, GRAN_DAY)));
        }
        // 15-minute steps in +05:45 land on local :00 / :15 / :30 / :45
        let tz = fixed(345.0);
        let ticks = time_ticks_tz(utc(2026, 6, 1, 0, 5), utc(2026, 6, 1, 1, 5), 4, &tz);
        assert!(walls(&tz, &ticks).iter().all(|&(_, _, m)| m % 15 == 0));
        assert!(ticks.iter().any(|t| t.1 == GRAN_MINUTE));
    }

    #[test]
    fn month_and_year_ticks_on_local_boundaries() {
        let ny = new_york();
        let ticks = time_ticks_tz(utc(2026, 1, 15, 0, 0), utc(2026, 12, 15, 0, 0), 12, &ny);
        // Local month starts: 05:00 UTC in winter, 04:00 UTC in summer
        assert_eq!(ticks[0], (utc(2026, 2, 1, 5, 0), GRAN_MONTH));
        assert!(ticks.contains(&(utc(2026, 4, 1, 4, 0), GRAN_MONTH)));
        assert!(ticks.contains(&(utc(2026, 11, 1, 4, 0), GRAN_MONTH)), "Nov 1 00:00 is still EDT");
        assert!(ticks.contains(&(utc(2026, 12, 1, 5, 0), GRAN_MONTH)));
        // Year boundary east of UTC: Jan 1 00:00 +05:30 is Dec 31 18:30 UTC
        let tz = fixed(330.0);
        let ticks = time_ticks_tz(utc(2025, 10, 1, 0, 0), utc(2026, 3, 1, 0, 0), 5, &tz);
        assert!(ticks.contains(&(utc(2025, 12, 31, 18, 30), GRAN_YEAR)));
        // A UTC month start is not a boundary there: plain UTC midnights are absent
        assert!(!ticks.iter().any(|&(t, _)| t == utc(2026, 1, 1, 0, 0)));
    }

    #[test]
    fn chart_axes_follow_the_zone_and_report_the_time_domain() {
        use crate::camera::OrbitCamera;
        use crate::chart::{ChartView, ChartViewMode, LineLayout, LineSeries};
        use glam::Vec3;
        // Hourly samples over 30 days around the New York spring switch
        let t0 = utc(2026, 2, 20, 0, 0);
        let x: Vec<f64> = (0..720).map(|h| t0 + h as f64 * HOUR).collect();
        let (lo, hi) = (x[0], x[719]);
        let series = vec![LineSeries { values: vec![1.0; 720], x: Some(x), color: [1.0; 4], width_px: 2.0 }];
        let layout = LineLayout { width: 160.0, height: 80.0, view: ChartViewMode::Flat, x_kind: LineXKind::Time };
        let mut chart = ChartState::new_line(series, layout);
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        let view = ChartView { camera: &cam, viewport_px: (1600, 900), pixel_ratio: 1.0 };
        assert_eq!(chart.time_x_domain(), Some((lo, hi)));
        chart.prepare_layers(&view);
        let utc_ticks: Vec<f64> = chart.axes().ticks.iter().filter(|t| t.axis == 0).map(|t| t.value).collect();
        assert!(utc_ticks.iter().all(|v| v.rem_euclid(DAY) == 0.0), "UTC midnights: {utc_ticks:?}");
        let rev = chart.axes_revision();
        chart.set_time_zone(new_york());
        chart.prepare_layers(&view);
        assert_ne!(chart.axes_revision(), rev);
        let ny = new_york();
        let xs: Vec<_> = chart.axes().ticks.iter().filter(|t| t.axis == 0).copied().collect();
        assert!(xs.len() >= 4);
        for t in &xs {
            assert_eq!(ny.to_local(t.value).rem_euclid(DAY), 0.0, "local midnight");
            assert!(t.granularity >= GRAN_DAY);
        }
        // Same table again: no re-layout; numeric x has no time domain
        let rev = chart.axes_revision();
        chart.set_time_zone(new_york());
        chart.prepare_layers(&view);
        assert_eq!(chart.axes_revision(), rev);
        let series = vec![LineSeries { values: vec![1.0; 3], x: Some(vec![0.0, 1.0, 2.0]), color: [1.0; 4], width_px: 2.0 }];
        let numeric = ChartState::new_line(series, LineLayout { x_kind: LineXKind::Numeric, ..layout });
        assert_eq!(numeric.time_x_domain(), None);
    }

    #[test]
    fn degenerate_ranges() {
        let ny = new_york();
        assert!(time_ticks_tz(f64::NAN, 1.0, 5, &ny).is_empty());
        assert!(time_ticks_tz(10.0, 0.0, 5, &ny).is_empty());
        assert!(time_ticks_tz(0.0, 1e15, 0, &ny).len() <= MAX_TICKS);
        assert!(time_ticks_tz(0.0, 1e7, 100_000, &ny).len() <= MAX_TICKS);
    }
}
