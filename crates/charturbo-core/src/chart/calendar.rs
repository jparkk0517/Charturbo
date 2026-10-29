//! Calendar heatmap: one cell per day in week columns (horizontal) or week rows (vertical).
//!
//! Days are civil day numbers (days since 1970-01-01; the SDK resolves dates and time zones).
//! Each range is one calendar block; blocks stack top to bottom (horizontal) or left to right
//! (vertical). Cells are laid out in CSS px (one world unit = one CSS px, like the treemap),
//! colored through the heatmap colormap / value scale, and rebuilt when the screen changes.
//! Month boundaries are drawn as split lines; day / month / year label anchors are computed
//! here and the DOM only places the localized text.

use super::heatmap::{
    colormap_lut, ColormapKind, HeatmapColormap, HeatmapDomain, ValueScale, COLORBAR_TICKS,
};
use super::hierarchy::{
    css_of, frame_css_plot, hover_one, padded_plot, push_outline, push_rect, FlatScreen,
};
use super::*;

/// Most days a calendar chart accepts over all its ranges.
pub const MAX_CALENDAR_DAYS: usize = 40_000;

/// Gap between calendar blocks (CSS px).
const BLOCK_GAP_PX: f32 = 16.0;
/// Largest automatic cell side (CSS px).
const MAX_AUTO_CELL_PX: f32 = 64.0;
/// Label anchors sit this far from the grid (CSS px).
const LABEL_GAP_PX: f32 = 6.0;
/// Hovered-day outline: outer ring in the surface color, inner ring on top (CSS px).
const OUTLINE_OUTER_PX: f32 = 3.0;
const OUTLINE_INNER_PX: f32 = 1.5;
/// Largest |day number| accepted (about 270 000 years either side of 1970).
const MAX_ABS_DAY: f64 = 1e8;

/// Days since 1970-01-01 of a proleptic Gregorian date (H. Hinnant's `days_from_civil`).
pub fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let (m, d) = (m as i64, d as i64);
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// `(year, month 1..=12, day 1..=31)` of a civil day number.
pub fn civil_from_days(z: i64) -> (i64, u32, u32) {
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

/// Day of the week of a civil day number: 0 = Sunday .. 6 = Saturday.
pub fn weekday(z: i64) -> u32 {
    (z + 4).rem_euclid(7) as u32
}

/// Next `(year, month)`.
fn next_month(y: i64, m: u32) -> (i64, u32) {
    if m == 12 {
        (y + 1, 1)
    } else {
        (y, m + 1)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CalendarOrient {
    /// Weeks run left to right, weekdays top to bottom
    #[default]
    Horizontal,
    /// Weeks run top to bottom, weekdays left to right
    Vertical,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CalendarOptions {
    pub orient: CalendarOrient,
    /// Largest cell side (CSS px); 0 = fit the plot
    pub cell_size: f32,
    /// Surface gap between cells (CSS px)
    pub cell_gap: f32,
    /// First weekday of a week: 0 = Sunday, 1 = Monday ..
    pub first_day: u8,
    /// CSS px reserved for the year / day-of-week / month labels (0 = hidden)
    pub year_label_px: f32,
    pub day_label_px: f32,
    pub month_label_px: f32,
    /// Month boundary lines (width 0 = none)
    pub split_color: [f32; 4],
    pub split_width: f32,
}

impl Default for CalendarOptions {
    fn default() -> Self {
        Self {
            orient: CalendarOrient::Horizontal,
            cell_size: 0.0,
            cell_gap: 2.0,
            first_day: 0,
            year_label_px: 0.0,
            day_label_px: 0.0,
            month_label_px: 0.0,
            split_color: [0.0, 0.0, 0.0, 1.0],
            split_width: 0.0,
        }
    }
}

/// DOM label anchor (CSS px from the canvas top-left).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CalendarLabel {
    /// 0 = day of week (`a` = weekday 0..6), 1 = month (`a` = year, `b` = month 1..12),
    /// 2 = year (`a` = first year, `b` = last year of the block)
    pub kind: u8,
    pub a: i32,
    pub b: i32,
    pub x_css: f32,
    pub y_css: f32,
    /// -1 = text ends at the anchor, 0 = centered, 1 = starts at it
    pub h_align: i8,
    /// -1 = text above the anchor, 0 = centered, 1 = below it
    pub v_align: i8,
}

/// Ranges are `[start, end]` day pairs (inclusive, integers); `days` integers with one value
/// each (days outside every range are dropped; non-finite values are empty days).
pub fn validate_calendar(ranges: &[f64], days: &[f64], values: usize) -> Result<(), String> {
    let day_ok = |v: f64| v.is_finite() && v.fract() == 0.0 && v.abs() <= MAX_ABS_DAY;
    if ranges.is_empty() || ranges.len() % 2 != 0 {
        return Err("calendar ranges must be [start, end] day pairs (at least one range)".into());
    }
    let mut total = 0.0;
    for (i, r) in ranges.chunks_exact(2).enumerate() {
        if !day_ok(r[0]) || !day_ok(r[1]) {
            return Err(format!("calendar range {i} must be whole day numbers"));
        }
        if r[0] > r[1] {
            return Err(format!("calendar range {i} start is after its end"));
        }
        total += r[1] - r[0] + 1.0;
    }
    if total > MAX_CALENDAR_DAYS as f64 {
        return Err(format!(
            "calendar ranges span {total} days (at most {MAX_CALENDAR_DAYS})"
        ));
    }
    if days.len() != values {
        return Err(format!(
            "calendar has {} days but {values} values",
            days.len()
        ));
    }
    match days.iter().position(|&d| !day_ok(d)) {
        Some(i) => Err(format!(
            "calendar day {i} is {} (whole day numbers only)",
            days[i]
        )),
        None => Ok(()),
    }
}

/// One calendar block (range).
#[derive(Debug, Clone, Copy, PartialEq)]
struct Block {
    start: i64,
    end: i64,
    /// Global id of `start`
    offset: u32,
    /// First day of the week holding `start`
    week0: i64,
    weeks: u32,
}

/// Screen layout of the blocks (CSS px).
#[derive(Debug, Clone, Default, PartialEq)]
struct Layout {
    /// Cell pitch (cell + gap)
    cell: f32,
    /// Top-left of each block's grid
    origins: Vec<(f32, f32)>,
    /// Bounding rect of every grid `[left, top, width, height]`
    bounds: [f32; 4],
}

#[derive(Debug, Clone)]
pub(crate) struct CalendarChart {
    opts: CalendarOptions,
    blocks: Vec<Block>,
    /// One value per day over all blocks (NaN = empty)
    values: Vec<f32>,
    data_range: (f64, f64),
    domain: HeatmapDomain,
    colormap: HeatmapColormap,
    scale: ValueScale,
    lut: Vec<[u8; 4]>,
    layout: Layout,
    layout_key: Option<([f32; 4], f32)>,
    /// Screen the fills were built for
    built: Option<FlatScreen>,
    /// Hovered day the overlay was built for
    outlined: Option<Option<u32>>,
    labels: Vec<CalendarLabel>,
    labels_revision: u32,
}

impl CalendarChart {
    fn new(ranges: &[f64], days: &[f64], values: &[f64], mut opts: CalendarOptions) -> Self {
        let clean = |v: f32, d: f32, hi: f32| if v.is_finite() { v.clamp(0.0, hi) } else { d };
        opts.cell_size = clean(opts.cell_size, 0.0, 512.0);
        opts.cell_gap = clean(opts.cell_gap, 2.0, 64.0);
        opts.first_day %= 7;
        opts.year_label_px = clean(opts.year_label_px, 0.0, 512.0);
        opts.day_label_px = clean(opts.day_label_px, 0.0, 512.0);
        opts.month_label_px = clean(opts.month_label_px, 0.0, 512.0);
        opts.split_width = clean(opts.split_width, 0.0, 16.0);
        let mut blocks = Vec::new();
        let mut offset = 0u32;
        for r in ranges.chunks_exact(2) {
            let (start, end) = (r[0] as i64, r[1] as i64);
            let lead = (weekday(start) as i64 - opts.first_day as i64).rem_euclid(7);
            let week0 = start - lead;
            let weeks = ((end - week0) / 7 + 1) as u32;
            blocks.push(Block {
                start,
                end,
                offset,
                week0,
                weeks,
            });
            offset += (end - start + 1) as u32;
        }
        let mut cells = vec![f32::NAN; offset as usize];
        for (&d, &v) in days.iter().zip(values) {
            let d = d as i64;
            for b in blocks.iter().filter(|b| (b.start..=b.end).contains(&d)) {
                cells[(b.offset as i64 + d - b.start) as usize] =
                    if v.is_finite() { v as f32 } else { f32::NAN };
            }
        }
        let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
        for &v in cells.iter().filter(|v| v.is_finite()) {
            lo = lo.min(v as f64);
            hi = hi.max(v as f64);
        }
        let data_range = if lo.is_finite() { (lo, hi) } else { (0.0, 1.0) };
        let (colormap, domain) = (HeatmapColormap::default(), HeatmapDomain::default());
        Self {
            opts,
            blocks,
            values: cells,
            data_range,
            domain,
            colormap,
            scale: ValueScale::resolve(data_range, &domain, false),
            lut: colormap_lut(&colormap),
            layout: Layout::default(),
            layout_key: None,
            built: None,
            outlined: None,
            labels: Vec::new(),
            labels_revision: 0,
        }
    }

    pub(crate) fn len(&self) -> usize {
        self.values.len()
    }

    pub(crate) fn lut(&self) -> &[[u8; 4]] {
        &self.lut
    }

    pub(crate) fn scale(&self) -> ValueScale {
        self.scale
    }

    pub(crate) fn set_colormap(&mut self, map: HeatmapColormap) {
        self.lut = colormap_lut(&map);
        self.colormap = map;
        self.resolve_scale();
    }

    /// Returns true when the scale changed.
    pub(crate) fn set_domain(&mut self, domain: HeatmapDomain) -> bool {
        self.domain = domain;
        self.resolve_scale()
    }

    fn resolve_scale(&mut self) -> bool {
        let diverging = self.colormap.kind == ColormapKind::Diverging;
        let scale = ValueScale::resolve(self.data_range, &self.domain, diverging);
        std::mem::replace(&mut self.scale, scale) != scale
    }

    /// Displayed color of a value (the empty color for NaN).
    pub(crate) fn color_of(&self, v: f32) -> [u8; 4] {
        match self.scale.normalize(v) {
            Some(t) => self.lut[ValueScale::lut_index(t)],
            None => self
                .colormap
                .empty
                .map(|c| (c.clamp(0.0, 1.0) * 255.0).round() as u8),
        }
    }

    fn fill_color(&self, v: f32) -> [f32; 4] {
        match self.scale.normalize(v) {
            Some(t) => self.lut[ValueScale::lut_index(t)].map(|c| c as f32 / 255.0),
            None => self.colormap.empty,
        }
    }

    pub(crate) fn colorbar_ticks(&self) -> Vec<(f64, f32)> {
        let (lo, hi) = (self.scale.lo as f64, self.scale.hi as f64);
        ticks_between(lo, hi, nice_step(hi - lo, COLORBAR_TICKS))
            .into_iter()
            .filter_map(|v| self.scale.normalize(v as f32).map(|t| (v, t)))
            .collect()
    }

    fn horizontal(&self) -> bool {
        self.opts.orient == CalendarOrient::Horizontal
    }

    /// `(block, day)` of a global id.
    fn day_of(&self, global_id: u32) -> Option<(usize, i64)> {
        let b = self.blocks.iter().rposition(|b| b.offset <= global_id)?;
        let blk = &self.blocks[b];
        let d = blk.start + (global_id - blk.offset) as i64;
        (d <= blk.end).then_some((b, d))
    }

    /// `(week, weekday row)` of a day in block `b`.
    fn week_pos(&self, b: usize, d: i64) -> (f32, f32) {
        let k = d - self.blocks[b].week0;
        ((k / 7) as f32, (k % 7) as f32)
    }

    /// CSS point of grid position `(week, weekday row)` of block `b` (axes swap when vertical).
    fn grid_css(&self, b: usize, week: f32, row: f32) -> (f32, f32) {
        let (ox, oy) = self.layout.origins[b];
        let (c, r) = if self.horizontal() {
            (week, row)
        } else {
            (row, week)
        };
        (ox + c * self.layout.cell, oy + r * self.layout.cell)
    }

    /// Reserved CSS px `(beside, above)` each block grid.
    fn reserve(&self) -> (f32, f32) {
        let o = &self.opts;
        if self.horizontal() {
            (o.year_label_px + o.day_label_px, o.month_label_px)
        } else {
            (o.month_label_px, o.year_label_px + o.day_label_px)
        }
    }

    fn compute_layout(&self, plot: [f32; 4], pixel_ratio: f32) -> Layout {
        let n = self.blocks.len().max(1) as f32;
        let weeks = self.blocks.iter().map(|b| b.weeks).max().unwrap_or(1) as f32;
        let (side, head) = self.reserve();
        let gap = BLOCK_GAP_PX;
        let fit = if self.horizontal() {
            ((plot[2] - side) / weeks).min((plot[3] - n * head - (n - 1.0) * gap) / (7.0 * n))
        } else {
            ((plot[2] - n * side - (n - 1.0) * gap) / (7.0 * n)).min((plot[3] - head) / weeks)
        };
        let cap = if self.opts.cell_size > 0.0 {
            self.opts.cell_size
        } else {
            MAX_AUTO_CELL_PX
        };
        let pr = pixel_ratio.max(0.1);
        // Whole device px: every cell and gap is identical
        let cell = ((fit.min(cap) * pr).floor() / pr).max(1.0);
        let (tw, th) = if self.horizontal() {
            (
                side + weeks * cell,
                n * (head + 7.0 * cell) + (n - 1.0) * gap,
            )
        } else {
            (
                n * (side + 7.0 * cell) + (n - 1.0) * gap,
                head + weeks * cell,
            )
        };
        let snap = |v: f32| (v * pr).round() / pr;
        let x0 = snap(plot[0] + (0.5 * (plot[2] - tw)).max(0.0));
        let y0 = snap(plot[1] + (0.5 * (plot[3] - th)).max(0.0));
        let origins: Vec<_> = (0..self.blocks.len())
            .map(|i| {
                let i = i as f32;
                if self.horizontal() {
                    (x0 + side, y0 + head + i * (head + 7.0 * cell + gap))
                } else {
                    (x0 + side + i * (side + 7.0 * cell + gap), y0 + head)
                }
            })
            .collect();
        let bounds = [x0 + side, y0 + head, tw - side, th - head];
        Layout {
            cell,
            origins,
            bounds,
        }
    }

    /// Day under a CSS point.
    fn day_at(&self, x: f32, y: f32) -> Option<u32> {
        let cell = self.layout.cell;
        if cell <= 0.0 {
            return None;
        }
        for (b, blk) in self.blocks.iter().enumerate() {
            let (ox, oy) = self.layout.origins[b];
            let (c, r) = (((x - ox) / cell).floor(), ((y - oy) / cell).floor());
            let (week, row) = if self.horizontal() { (c, r) } else { (r, c) };
            if !(0.0..7.0).contains(&row) || week < 0.0 || week >= blk.weeks as f32 {
                continue;
            }
            let d = blk.week0 + week as i64 * 7 + row as i64;
            if (blk.start..=blk.end).contains(&d) {
                return Some(blk.offset + (d - blk.start) as u32);
            }
        }
        None
    }

    pub(crate) fn frame_camera(
        &self,
        camera: &mut OrbitCamera,
        css: (f32, f32),
        padding: &ChartPadding,
    ) {
        frame_css_plot(camera, css, padding);
    }

    /// `(0, day id, value, cell center)` (needs a prepared frame).
    pub(crate) fn sample(&self, global_id: u32) -> Option<(u32, u32, f32, Vec3)> {
        let screen = self.built?;
        let (b, d) = self.day_of(global_id)?;
        let (w, r) = self.week_pos(b, d);
        let (x, y) = self.grid_css(b, w + 0.5, r + 0.5);
        let (wx, wy) = screen.world(x, y);
        Some((
            0,
            global_id,
            self.values[global_id as usize],
            Vec3::new(wx, wy, 0.0),
        ))
    }

    pub(crate) fn hover(&self, view: &ChartView, ndc: (f32, f32)) -> Option<HoverResult> {
        let screen = FlatScreen::of(view)?;
        let (x, y) = screen.css_at(view, ndc)?;
        let id = self.day_at(x, y)?;
        Some(hover_one(0, id, self.values[id as usize] as f64, id))
    }

    pub(crate) fn axes(&self, view: &ChartView, padding: &ChartPadding, out: &mut AxisLayout) {
        out.ticks.clear();
        out.plot_css = self
            .compute_layout(padded_plot(css_of(view), padding), view.pixel_ratio)
            .bounds;
    }

    /// Snapped CSS rect of a day's cell (gap removed).
    fn cell_rect(&self, screen: &FlatScreen, b: usize, d: i64) -> [f32; 4] {
        let (w, r) = self.week_pos(b, d);
        let (x, y) = self.grid_css(b, w, r);
        let cell = self.layout.cell;
        let g = 0.5 * self.opts.cell_gap.min(cell * 0.25);
        let (x0, y0) = (screen.snap(x + g), screen.snap(y + g));
        let (x1, y1) = (screen.snap(x + cell - g), screen.snap(y + cell - g));
        [x0, y0, (x1 - x0).max(0.0), (y1 - y0).max(0.0)]
    }

    fn build_fills(&self, screen: &FlatScreen, fills: &mut Vec<ChartFillRaw>) {
        fills.clear();
        for (b, blk) in self.blocks.iter().enumerate() {
            for d in blk.start..=blk.end {
                let v = self.values[(blk.offset as i64 + d - blk.start) as usize];
                push_rect(
                    screen,
                    self.cell_rect(screen, b, d),
                    self.fill_color(v),
                    fills,
                );
            }
        }
    }

    /// One split segment between grid points `(week, row)`, extended by half its width so
    /// corners join.
    fn split_segment(
        &self,
        screen: &FlatScreen,
        b: usize,
        a: (f32, f32),
        c: (f32, f32),
        out: &mut Vec<ChartSegmentRaw>,
    ) {
        let w = self.opts.split_width;
        let (pa, pc) = (self.grid_css(b, a.0, a.1), self.grid_css(b, c.0, c.1));
        let len = (pc.0 - pa.0).hypot(pc.1 - pa.1).max(1e-6);
        let (ux, uy) = (0.5 * w * (pc.0 - pa.0) / len, 0.5 * w * (pc.1 - pa.1) / len);
        let (p0, p1) = (
            screen.world(pa.0 - ux, pa.1 - uy),
            screen.world(pc.0 + ux, pc.1 + uy),
        );
        out.push(ChartSegmentRaw {
            p0_width: [p0.0, p0.1, 0.0, w],
            p1_pad: [p1.0, p1.1, 0.0, 0.0],
            color: self.opts.split_color,
        });
    }

    /// Boundary before day `d` of block `b`: a straight week edge, or a step around the
    /// weekdays already taken by the previous month.
    fn split_boundary(
        &self,
        screen: &FlatScreen,
        b: usize,
        d: i64,
        out: &mut Vec<ChartSegmentRaw>,
    ) {
        let (x, r) = self.week_pos(b, d);
        if r == 0.0 {
            self.split_segment(screen, b, (x, 0.0), (x, 7.0), out);
        } else {
            self.split_segment(screen, b, (x + 1.0, 0.0), (x + 1.0, r), out);
            self.split_segment(screen, b, (x + 1.0, r), (x, r), out);
            self.split_segment(screen, b, (x, r), (x, 7.0), out);
        }
    }

    /// Month outlines: the boundary before every month start (and after the end) plus the
    /// first / last weekday edges.
    fn build_split(&self, screen: &FlatScreen, out: &mut Vec<ChartSegmentRaw>) {
        out.clear();
        if self.opts.split_width <= 0.0 || self.opts.split_color[3] <= 0.0 {
            return;
        }
        for (b, blk) in self.blocks.iter().enumerate() {
            self.split_boundary(screen, b, blk.start, out);
            let (y, m, _) = civil_from_days(blk.start);
            let (mut y, mut m) = next_month(y, m);
            while days_from_civil(y, m, 1) <= blk.end {
                self.split_boundary(screen, b, days_from_civil(y, m, 1), out);
                (y, m) = next_month(y, m);
            }
            self.split_boundary(screen, b, blk.end + 1, out);
            let (ex, er) = self.week_pos(b, blk.end);
            let (sx, sr) = self.week_pos(b, blk.start);
            let top0 = if sr == 0.0 { sx } else { sx + 1.0 };
            if ex + 1.0 > top0 {
                self.split_segment(screen, b, (top0, 0.0), (ex + 1.0, 0.0), out);
            }
            let bottom1 = if er == 6.0 { ex + 1.0 } else { ex };
            if bottom1 > sx {
                self.split_segment(screen, b, (sx, 7.0), (bottom1, 7.0), out);
            }
        }
    }

    fn build_outline(
        &self,
        screen: &FlatScreen,
        hovered: Option<u32>,
        style: &ChartHoverStyle,
        out: &mut Vec<ChartSegmentRaw>,
    ) {
        out.clear();
        let Some((b, d)) = hovered.and_then(|id| self.day_of(id)) else {
            return;
        };
        if !style.marker {
            return;
        }
        let r = self.cell_rect(screen, b, d);
        let c = style.crosshair_color;
        let inner = style.bar_highlight_color.unwrap_or([c[0], c[1], c[2], 1.0]);
        let ring = [r[0] - 1.0, r[1] - 1.0, r[2] + 2.0, r[3] + 2.0];
        push_outline(screen, ring, OUTLINE_OUTER_PX, style.marker_ring_color, out);
        push_outline(screen, r, OUTLINE_INNER_PX, inner, out);
    }

    fn layout_labels(&mut self) {
        let mut out = Vec::new();
        let o = self.opts;
        let cell = self.layout.cell;
        let h = self.horizontal();
        for (b, blk) in self.blocks.iter().enumerate() {
            let (ox, oy) = self.layout.origins[b];
            if o.day_label_px > 0.0 {
                for r in 0..7u32 {
                    let a = ((o.first_day as u32 + r) % 7) as i32;
                    let m = (r as f32 + 0.5) * cell;
                    out.push(if h {
                        CalendarLabel {
                            kind: 0,
                            a,
                            b: 0,
                            x_css: ox - LABEL_GAP_PX,
                            y_css: oy + m,
                            h_align: -1,
                            v_align: 0,
                        }
                    } else {
                        CalendarLabel {
                            kind: 0,
                            a,
                            b: 0,
                            x_css: ox + m,
                            y_css: oy - LABEL_GAP_PX,
                            h_align: 0,
                            v_align: -1,
                        }
                    });
                }
            }
            if o.month_label_px > 0.0 {
                let (mut y, mut m, _) = civil_from_days(blk.start);
                let mut first = blk.start;
                while first <= blk.end {
                    let k = first - blk.week0;
                    // A month starting mid-week is labelled at its first full week (its own
                    // week when it starts in the last one)
                    let full = k % 7 == 0 || first == blk.start;
                    let week = ((k / 7) as f32 + if full { 0.0 } else { 1.0 })
                        .min(blk.weeks.saturating_sub(1) as f32);
                    let at = week * cell;
                    out.push(if h {
                        CalendarLabel {
                            kind: 1,
                            a: y as i32,
                            b: m as i32,
                            x_css: ox + at,
                            y_css: oy - LABEL_GAP_PX,
                            h_align: 1,
                            v_align: -1,
                        }
                    } else {
                        CalendarLabel {
                            kind: 1,
                            a: y as i32,
                            b: m as i32,
                            x_css: ox - LABEL_GAP_PX,
                            y_css: oy + at,
                            h_align: -1,
                            v_align: 1,
                        }
                    });
                    (y, m) = next_month(y, m);
                    first = days_from_civil(y, m, 1);
                }
            }
            if o.year_label_px > 0.0 {
                let (a, last) = (
                    civil_from_days(blk.start).0 as i32,
                    civil_from_days(blk.end).0 as i32,
                );
                let off = o.day_label_px + 0.5 * o.year_label_px;
                out.push(if h {
                    CalendarLabel {
                        kind: 2,
                        a,
                        b: last,
                        x_css: ox - off,
                        y_css: oy + 3.5 * cell,
                        h_align: 0,
                        v_align: 0,
                    }
                } else {
                    CalendarLabel {
                        kind: 2,
                        a,
                        b: last,
                        x_css: ox + 3.5 * cell,
                        y_css: oy - off,
                        h_align: 0,
                        v_align: 0,
                    }
                });
            }
        }
        if out != self.labels {
            self.labels = out;
            self.labels_revision = self.labels_revision.wrapping_add(1);
        }
    }
}

impl ChartState {
    /// Creates a calendar heatmap from validated input (see `validate_calendar`).
    pub fn new_calendar(
        ranges: &[f64],
        days: &[f64],
        values: &[f64],
        opts: CalendarOptions,
    ) -> Self {
        Self::with_kind(ChartKind::Calendar(CalendarChart::new(
            ranges, days, values, opts,
        )))
    }

    /// Split line color / width (theme changes keep the layout).
    pub fn set_calendar_split_line(&mut self, color: [f32; 4], width: f32) {
        if let ChartKind::Calendar(c) = &mut self.kind {
            c.opts.split_color = color;
            c.opts.split_width = if width.is_finite() {
                width.clamp(0.0, 16.0)
            } else {
                0.0
            };
            self.dirty.fills = true;
        }
    }

    /// Label anchors of the last prepared frame and their revision.
    pub fn calendar_labels(&self) -> Option<(&[CalendarLabel], u32)> {
        match &self.kind {
            ChartKind::Calendar(c) => Some((&c.labels, c.labels_revision)),
            _ => None,
        }
    }

    /// `(start day, end day, first global id)` per calendar block.
    pub fn calendar_blocks(&self) -> Option<Vec<(i64, i64, u32)>> {
        match &self.kind {
            ChartKind::Calendar(c) => Some(
                c.blocks
                    .iter()
                    .map(|b| (b.start, b.end, b.offset))
                    .collect(),
            ),
            _ => None,
        }
    }

    /// Calendar part of `prepare_layers`.
    pub(crate) fn prepare_calendar(&mut self, view: &ChartView) {
        let hovered = self
            .hover
            .as_ref()
            .and_then(|h| h.items.get(h.primary))
            .map(|i| i.global_id);
        let ChartKind::Calendar(c) = &mut self.kind else {
            return;
        };
        let Some(screen) = FlatScreen::of(view) else {
            return;
        };
        let plot = padded_plot(css_of(view), &self.padding);
        let key = (plot, screen.pixel_ratio);
        if c.layout_key != Some(key) {
            c.layout = c.compute_layout(plot, screen.pixel_ratio);
            c.layout_key = Some(key);
            c.layout_labels();
            c.built = None;
        }
        if self.dirty.fills || c.built != Some(screen) {
            c.build_fills(&screen, &mut self.fills);
            c.build_split(&screen, &mut self.series);
            c.built = Some(screen);
            c.outlined = None;
            self.dirty.fills = true;
            self.dirty.series = true;
        }
        if self.dirty.overlay || c.outlined != Some(hovered) {
            c.build_outline(&screen, hovered, &self.hover_style, &mut self.overlay);
            self.markers.clear();
            c.outlined = Some(hovered);
            self.dirty.overlay = true;
        }
        if self.dirty.underlay {
            self.underlay.clear();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn view(cam: &OrbitCamera) -> ChartView<'_> {
        ChartView {
            camera: cam,
            viewport_px: (1600, 900),
            pixel_ratio: 1.0,
        }
    }

    fn day(y: i64, m: u32, d: u32) -> f64 {
        days_from_civil(y, m, d) as f64
    }

    fn calendar(
        ranges: &[f64],
        data: &[(f64, f64)],
        opts: CalendarOptions,
    ) -> (ChartState, OrbitCamera) {
        let days: Vec<f64> = data.iter().map(|d| d.0).collect();
        let values: Vec<f64> = data.iter().map(|d| d.1).collect();
        validate_calendar(ranges, &days, values.len()).unwrap();
        let mut chart = ChartState::new_calendar(ranges, &days, &values, opts);
        chart.set_padding([20.0, 20.0, 20.0, 20.0]);
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        (chart, cam)
    }

    fn ndc_of(chart: &ChartState, cam: &OrbitCamera, id: u32) -> (f32, f32) {
        let p = chart.sample(id).unwrap().3;
        let n = cam.project_to_ndc(p).unwrap();
        (n.x, n.y)
    }

    fn css_of_id(chart: &ChartState, cam: &OrbitCamera, id: u32) -> (f32, f32) {
        view(cam).project_css(chart.sample(id).unwrap().3).unwrap()
    }

    fn year(y: i64) -> [f64; 2] {
        [day(y, 1, 1), day(y, 12, 31)]
    }

    #[test]
    fn civil_dates_round_trip_and_weekdays() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2000, 3, 1), 11017);
        assert_eq!(days_from_civil(1969, 12, 31), -1);
        for z in [-800_000i64, -1, 0, 59, 11016, 19782, 19783, 2_932_896] {
            let (y, m, d) = civil_from_days(z);
            assert_eq!(days_from_civil(y, m, d), z);
        }
        assert_eq!(civil_from_days(days_from_civil(2024, 2, 29)), (2024, 2, 29));
        assert_eq!(weekday(0), 4, "1970-01-01 was a Thursday");
        assert_eq!(weekday(days_from_civil(2024, 1, 1)), 1, "Monday");
        assert_eq!(weekday(-1), 3);
    }

    #[test]
    fn input_is_validated() {
        assert!(validate_calendar(&[], &[], 0)
            .unwrap_err()
            .contains("range"));
        assert!(validate_calendar(&[5.0], &[], 0).is_err(), "odd range list");
        assert!(validate_calendar(&[5.0, 1.0], &[], 0)
            .unwrap_err()
            .contains("start"));
        assert!(
            validate_calendar(&[0.5, 3.0], &[], 0).is_err(),
            "fractional day"
        );
        assert!(validate_calendar(&[0.0, 1e6], &[], 0)
            .unwrap_err()
            .contains("days"));
        assert!(validate_calendar(&[0.0, 9.0], &[1.0], 2)
            .unwrap_err()
            .contains("value"));
        assert!(validate_calendar(&[0.0, 9.0], &[f64::NAN], 1).is_err());
        assert!(
            validate_calendar(&[0.0, 9.0, 20.0, 30.0], &[1.0, 99.0], 2).is_ok(),
            "out-of-range days are dropped"
        );
    }

    #[test]
    fn horizontal_cells_follow_weeks_and_the_first_weekday() {
        let r = year(2024);
        let (mut c, cam) = calendar(
            &r,
            &[(day(2024, 1, 1), 5.0), (day(2024, 3, 1), 10.0)],
            CalendarOptions::default(),
        );
        let v = view(&cam);
        let fills = c.prepare_layers(&v).fills.unwrap().len();
        assert_eq!(fills, 366 * 6, "one quad per day");
        assert_eq!(c.point_count(), 366);
        // Sunday first: Mon 2024-01-01 sits in row 1, Sun 2024-01-07 in row 0 of the next week
        let (x1, y1) = css_of_id(&c, &cam, 0);
        let (x7, y7) = css_of_id(&c, &cam, 6);
        let (x8, y8) = css_of_id(&c, &cam, 7);
        assert!(y7 < y1 && x7 > x1, "Sunday starts the next column");
        assert!((x8 - x7).abs() < 1e-3 && y8 > y7, "Monday below Sunday");
        let cell = y8 - y7;
        assert!((x7 - x1 - cell).abs() < 1e-3, "square cells");
        // Monday first: the first week holds Jan 1 .. Jan 7 in one column
        let (mut m, mcam) = calendar(
            &r,
            &[],
            CalendarOptions {
                first_day: 1,
                ..Default::default()
            },
        );
        m.prepare_layers(&view(&mcam));
        let (a, b) = (css_of_id(&m, &mcam, 0), css_of_id(&m, &mcam, 6));
        assert!((a.0 - b.0).abs() < 1e-3 && b.1 > a.1);
        // Fits the plot width (53 + 1 week columns within 1560 px) and centers it
        let plot = {
            c.prepare_layers(&v);
            c.axes().plot_css
        };
        assert!(plot[2] <= 1560.0 + 1e-3 && plot[2] > 1400.0, "{plot:?}");
        assert!((plot[0] + 0.5 * plot[2] - 800.0).abs() < 2.0);
        assert!((plot[3] / plot[2] - 7.0 / 53.0).abs() < 0.01);
    }

    #[test]
    fn hover_hits_days_with_or_without_data_and_outlines_them() {
        let r = year(2024);
        let (mut c, cam) = calendar(
            &r,
            &[(day(2024, 1, 1), 5.0), (day(2024, 3, 1), 10.0)],
            CalendarOptions::default(),
        );
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        c.prepare_layers(&v);
        let hit = c.hover_at(&v, &mut scene, ndc_of(&c, &cam, 60)).unwrap();
        assert_eq!(
            (
                hit.items[0].index,
                hit.items[0].global_id,
                hit.items[0].value
            ),
            (60, 60, 10.0)
        );
        let hit = c.hover_at(&v, &mut scene, ndc_of(&c, &cam, 1)).unwrap();
        assert_eq!(hit.items[0].index, 1);
        assert!(hit.items[0].value.is_nan(), "empty day still hovers");
        assert_eq!(
            c.prepare_layers(&v).overlay.unwrap().len(),
            8,
            "two-tone outline"
        );
        // Every day's center hovers itself
        for id in [0u32, 6, 7, 59, 200, 365] {
            assert_eq!(
                c.hover_at(&v, &mut scene, ndc_of(&c, &cam, id))
                    .unwrap()
                    .items[0]
                    .index,
                id
            );
        }
        // Sunday 2023-12-31 shares the first column but is outside the range
        let (x, y) = css_of_id(&c, &cam, 0);
        let (_, y7) = css_of_id(&c, &cam, 6);
        let cell = css_of_id(&c, &cam, 7).1 - y7;
        let (wx, wy) = super::super::hierarchy::FlatScreen::of(&v)
            .unwrap()
            .world(x, y - cell);
        let n = cam.project_to_ndc(Vec3::new(wx, wy, 0.0)).unwrap();
        assert!(c.hover_at(&v, &mut scene, (n.x, n.y)).is_none());
        assert_eq!(c.prepare_layers(&v).overlay.unwrap().len(), 0);
    }

    #[test]
    fn values_use_the_heatmap_colormap_and_empty_days_the_empty_color() {
        let r = year(2024);
        let (mut c, cam) = calendar(
            &r,
            &[(day(2024, 1, 1), 0.0), (day(2024, 1, 2), 100.0)],
            CalendarOptions::default(),
        );
        let empty = [0.9, 0.9, 0.9, 1.0];
        c.set_heatmap_colormap(HeatmapColormap {
            empty,
            ..Default::default()
        });
        let v = view(&cam);
        let fills = c.prepare_layers(&v).fills.unwrap().to_vec();
        let lut = c.heatmap_lut().unwrap().to_vec();
        let rgba = |k: usize| lut[k].map(|v| v as f32 / 255.0);
        assert_eq!(fills[0].color, rgba(0));
        assert_eq!(fills[6].color, rgba(lut.len() - 1));
        assert_eq!(fills[12].color, empty);
        assert_eq!(c.heatmap_color(100.0), Some(lut[lut.len() - 1]));
        let bar = c.heatmap_colorbar().unwrap();
        assert_eq!((bar.scale.lo, bar.scale.hi), (0.0, 100.0));
        c.set_heatmap_domain(HeatmapDomain {
            max: Some(200.0),
            ..Default::default()
        });
        let fills = c.prepare_layers(&v).fills.unwrap().to_vec();
        assert_ne!(fills[6].color, rgba(lut.len() - 1), "domain re-colors");
    }

    #[test]
    fn month_boundaries_are_split_lines() {
        // Jan 1 2024 is a Monday: Monday first -> the start is a straight column edge (1 segment);
        // Feb 1 (Thu) and Mar 1 (Fri) step (3 segments each); + top and bottom edges
        let opts = CalendarOptions {
            first_day: 1,
            split_width: 1.0,
            split_color: [0.2, 0.2, 0.2, 1.0],
            ..Default::default()
        };
        let (mut c, cam) = calendar(&[day(2024, 1, 1), day(2024, 2, 29)], &[], opts);
        let v = view(&cam);
        assert_eq!(c.prepare_layers(&v).series.unwrap().len(), 1 + 3 + 3 + 2);
        c.set_calendar_split_line([0.2, 0.2, 0.2, 1.0], 0.0);
        assert_eq!(c.prepare_layers(&v).series.unwrap().len(), 0);
    }

    #[test]
    fn several_ranges_stack_and_number_days_on() {
        let ranges = [year(2023), year(2024)].concat();
        let (mut c, cam) = calendar(
            &ranges,
            &[(day(2024, 1, 1), 1.0), (day(2023, 1, 1), 2.0)],
            CalendarOptions::default(),
        );
        let v = view(&cam);
        c.prepare_layers(&v);
        assert_eq!(c.point_count(), 365 + 366);
        assert_eq!(
            c.calendar_blocks().unwrap(),
            vec![
                (day(2023, 1, 1) as i64, day(2023, 12, 31) as i64, 0),
                (day(2024, 1, 1) as i64, day(2024, 12, 31) as i64, 365)
            ]
        );
        assert_eq!(c.sample(365).unwrap().2, 1.0);
        assert_eq!(c.sample(0).unwrap().2, 2.0);
        let (a, b) = (css_of_id(&c, &cam, 0), css_of_id(&c, &cam, 365));
        assert!(b.1 > a.1 + 7.0 * 10.0, "2024 below 2023");
        // Vertical: blocks side by side, weeks run down, weekdays across
        let (mut vc, vcam) = calendar(
            &ranges,
            &[],
            CalendarOptions {
                orient: CalendarOrient::Vertical,
                first_day: 1,
                ..Default::default()
            },
        );
        vc.prepare_layers(&view(&vcam));
        let jan1 = css_of_id(&vc, &vcam, 365);
        let jan2 = css_of_id(&vc, &vcam, 366);
        let jan8 = css_of_id(&vc, &vcam, 372);
        assert!(
            jan2.0 > jan1.0 && (jan2.1 - jan1.1).abs() < 1e-3,
            "weekdays across"
        );
        assert!(
            jan8.1 > jan1.1 && (jan8.0 - jan1.0).abs() < 1e-3,
            "weeks down"
        );
        assert!(
            jan1.0 > css_of_id(&vc, &vcam, 1).0 + 7.0 * 5.0,
            "2024 right of 2023"
        );
    }

    #[test]
    fn cell_size_caps_and_labels_sit_outside_the_grid() {
        let opts = CalendarOptions {
            cell_size: 12.0,
            year_label_px: 24.0,
            day_label_px: 30.0,
            month_label_px: 18.0,
            ..Default::default()
        };
        let (mut c, cam) = calendar(&year(2024), &[], opts);
        let v = view(&cam);
        c.prepare_layers(&v);
        let cell = css_of_id(&c, &cam, 7).1 - css_of_id(&c, &cam, 6).1;
        assert!((cell - 12.0).abs() < 1e-3);
        let plot = c.axes().plot_css;
        let (labels, rev) = c.calendar_labels().unwrap();
        let labels = labels.to_vec();
        assert_eq!(labels.iter().filter(|l| l.kind == 0).count(), 7);
        let months: Vec<_> = labels.iter().filter(|l| l.kind == 1).collect();
        assert_eq!(months.len(), 12);
        assert_eq!((months[0].a, months[0].b, months[11].b), (2024, 1, 12));
        assert!(months.windows(2).all(|w| w[1].x_css > w[0].x_css));
        assert!(months.iter().all(|l| l.y_css <= plot[1] && l.v_align == -1));
        let days: Vec<_> = labels.iter().filter(|l| l.kind == 0).collect();
        assert!(days.iter().all(|l| l.x_css <= plot[0] && l.h_align == -1));
        assert_eq!(days[0].a, 0, "Sunday first");
        let years: Vec<_> = labels.iter().filter(|l| l.kind == 2).collect();
        assert_eq!((years.len(), years[0].a, years[0].b), (1, 2024, 2024));
        assert!(years[0].x_css < days[0].x_css);
        // Stable frames keep the revision; a resize re-lays out
        c.prepare_layers(&v);
        assert_eq!(c.calendar_labels().unwrap().1, rev);
        c.set_padding([20.0, 20.0, 20.0, 200.0]);
        c.prepare_layers(&v);
        assert_ne!(c.calendar_labels().unwrap().1, rev);
    }

    #[test]
    fn a_month_in_the_last_partial_week_is_labelled_inside_the_grid() {
        // Feb 1 2023 is a Wednesday in the last (partial) week: no full week follows it
        let range = [
            days_from_civil(2023, 1, 1) as f64,
            days_from_civil(2023, 2, 3) as f64,
        ];
        let opts = CalendarOptions {
            month_label_px: 18.0,
            ..Default::default()
        };
        let (mut c, cam) = calendar(&range, &[], opts);
        c.prepare_layers(&view(&cam));
        let plot = c.axes().plot_css;
        let (labels, _) = c.calendar_labels().unwrap();
        let feb = labels.iter().find(|l| l.kind == 1 && l.b == 2).unwrap();
        assert!(
            feb.x_css < plot[0] + plot[2],
            "{} vs {}",
            feb.x_css,
            plot[0] + plot[2]
        );
    }

    #[test]
    fn exports_cells_and_split_lines_as_vector_svg() {
        let opts = CalendarOptions {
            split_width: 1.0,
            ..Default::default()
        };
        let (mut c, cam) = calendar(&year(2024), &[(day(2024, 5, 1), 3.0)], opts);
        let v = view(&cam);
        c.prepare_layers(&v);
        assert_eq!(c.svg_support(), SvgSupport::Vector);
        let svg = c.export_svg(&v, 0, "cal");
        assert!(!svg.truncated && svg.marks > 366, "{}", svg.marks);
        assert!(svg.markup.contains("data-layer=\"series\""));
    }
}
