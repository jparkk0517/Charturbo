//! Decal (pattern fill) of bars and filled marks (ECharts `aria.decal` / `itemStyle.decal`).
//!
//! Patterns are procedural: a second GPU pass redraws the decorated bars / fill triangles with
//! a per-mark `ChartDecalRaw` (symbol, size, spacing, rotation, color) and the fragment shader
//! tiles the symbol in screen space (anchored at the canvas top-left, so patterns do not move
//! with the data while panning, like ECharts' canvas patterns). Charts without decals stage
//! nothing: the decal pass is skipped and the frame is unchanged.
//!
//! Decals are keyed per kind: bars by global id (`series * categories + category`), pie
//! slices by color group, funnel stages by index, area series by index, treemap / sunburst
//! cells by node id. Fill builders record the vertex range of every mark (`DecalRun`).

use crate::renderer::ChartDecalRaw;

/// Floats per decal spec: `[symbol, size, spacing, rotation_rad, r, g, b, opacity]`.
pub const DECAL_SPEC_STRIDE: usize = 8;
/// Symbols: 0 none, 1 rect, 2 circle, 3 triangle, 4 diamond, 5 line (stripes), 6 cross.
pub const DECAL_SYMBOL_MAX: u32 = 6;

/// Fill vertices `start..end` drawn for the mark with decal key `key`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct DecalRun {
    pub start: u32,
    pub end: u32,
    pub key: u32,
}

/// Records the vertices a builder appended since `start` as one mark.
pub(crate) fn push_run(runs: &mut Vec<DecalRun>, start: usize, end: usize, key: u32) {
    if end > start {
        runs.push(DecalRun {
            start: start as u32,
            end: end as u32,
            key,
        });
    }
}

/// Symbol code of a decal (0 = none).
pub(crate) fn symbol_of(d: &ChartDecalRaw) -> u32 {
    (d.pattern[0].max(0.0) + 0.5) as u32
}

/// Validates `specs` (`DECAL_SPEC_STRIDE` floats per key; empty = decals off).
pub fn parse_decal_specs(specs: &[f32]) -> Result<Vec<ChartDecalRaw>, String> {
    if !specs.len().is_multiple_of(DECAL_SPEC_STRIDE) {
        return Err(format!(
            "decal specs: length {} is not a multiple of {DECAL_SPEC_STRIDE}",
            specs.len()
        ));
    }
    let mut out = Vec::with_capacity(specs.len() / DECAL_SPEC_STRIDE);
    for (k, s) in specs.chunks_exact(DECAL_SPEC_STRIDE).enumerate() {
        let [symbol, size, spacing, rotation, r, g, b, a] =
            [s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7]];
        if !(symbol.is_finite()
            && symbol >= 0.0
            && symbol.fract() == 0.0
            && symbol as u32 <= DECAL_SYMBOL_MAX)
        {
            return Err(format!(
                "decal {k}: symbol must be an integer 0..={DECAL_SYMBOL_MAX}"
            ));
        }
        if symbol == 0.0 {
            out.push(ChartDecalRaw::default());
            continue;
        }
        if !(size.is_finite() && size > 0.0 && size <= 512.0) {
            return Err(format!("decal {k}: symbolSize must be in (0, 512]"));
        }
        if !(spacing.is_finite() && (1.0..=1024.0).contains(&spacing)) {
            return Err(format!("decal {k}: spacing must be in [1, 1024]"));
        }
        if !rotation.is_finite() {
            return Err(format!("decal {k}: rotation must be finite"));
        }
        let auto = r == -1.0;
        let channel = |v: f32| v.is_finite() && (0.0..=1.0).contains(&v);
        if !(auto || (channel(r) && channel(g) && channel(b))) {
            return Err(format!(
                "decal {k}: color channels must be in [0, 1] (r = -1: auto contrast)"
            ));
        }
        if !channel(a) {
            return Err(format!("decal {k}: opacity must be in [0, 1]"));
        }
        let rgb = if auto { [-1.0, 0.0, 0.0] } else { [r, g, b] };
        out.push(ChartDecalRaw {
            pattern: [symbol, size, spacing, rotation],
            color: [rgb[0], rgb[1], rgb[2], a],
        });
    }
    Ok(out)
}

/// Color the decal pass paints over a mark of color `base` (CPU mirror of `decal_paint` in
/// WGSL): auto contrast picks black on light marks, white on dark ones; alpha = opacity times
/// the mark's alpha.
pub(crate) fn decal_paint(d: &ChartDecalRaw, base: [f32; 4]) -> [f32; 4] {
    let rgb = if d.color[0] < 0.0 {
        let lum = 0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2];
        if lum > 0.5 {
            [0.0; 3]
        } else {
            [1.0; 3]
        }
    } else {
        [d.color[0], d.color[1], d.color[2]]
    };
    [rgb[0], rgb[1], rgb[2], d.color[3] * base[3]]
}

/// Half thickness (CSS px) of the cross symbol's arms for half-size `r` (as the shader).
pub(crate) fn cross_half_thickness(r: f32) -> f32 {
    (0.25 * r).max(0.5)
}

/// Decal specs by key plus the decals staged for the current bars / fills.
#[derive(Debug, Clone, Default)]
pub(crate) struct Decals {
    specs: Vec<ChartDecalRaw>,
    on: bool,
    /// Fill vertex range of every decorated mark of the staged fills (set by the builders)
    pub fill_runs: Vec<DecalRun>,
    bars: Vec<ChartDecalRaw>,
    fills: Vec<ChartDecalRaw>,
}

impl Decals {
    pub fn set(&mut self, specs: Vec<ChartDecalRaw>) {
        self.on = specs.iter().any(|d| symbol_of(d) != 0);
        self.specs = if self.on { specs } else { Vec::new() };
    }

    pub fn is_on(&self) -> bool {
        self.on
    }

    fn spec(&self, key: usize) -> ChartDecalRaw {
        self.specs.get(key).copied().unwrap_or_default()
    }

    /// One decal per staged bar: `ids` are the global ids of the last `ids.len()` bars (the
    /// leading tracks / race exits get none). Empty when no bar is decorated.
    pub fn stage_bars(&mut self, bars: usize, ids: &[usize]) {
        self.bars.clear();
        if !self.on || ids.len() > bars {
            return;
        }
        self.bars.resize(bars - ids.len(), ChartDecalRaw::default());
        for &g in ids {
            self.bars.push(self.spec(g));
        }
        if self.bars.iter().all(|d| symbol_of(d) == 0) {
            self.bars.clear();
        }
    }

    /// One decal per staged fill vertex from `fill_runs`. Empty when no vertex is decorated.
    pub fn stage_fills(&mut self, fills: usize) {
        self.fills.clear();
        if !self.on {
            return;
        }
        self.fills.resize(fills, ChartDecalRaw::default());
        let mut any = false;
        for run in &self.fill_runs {
            let d = self
                .specs
                .get(run.key as usize)
                .copied()
                .unwrap_or_default();
            if symbol_of(&d) == 0 {
                continue;
            }
            let (a, b) = (
                (run.start as usize).min(fills),
                (run.end as usize).min(fills),
            );
            self.fills[a..b].fill(d);
            any |= b > a;
        }
        if !any {
            self.fills.clear();
        }
    }

    /// Staged bar decals (empty or one per staged bar).
    pub fn bars(&self) -> &[ChartDecalRaw] {
        &self.bars
    }

    /// Staged fill decals (empty or one per staged fill vertex).
    pub fn fills(&self) -> &[ChartDecalRaw] {
        &self.fills
    }
}

impl super::ChartState {
    /// Sets the decal specs by key (`DECAL_SPEC_STRIDE` floats each, see `parse_decal_specs`;
    /// empty = off). Invalid specs keep the current decals.
    pub fn set_decals(&mut self, specs: &[f32]) -> Result<(), String> {
        let parsed = parse_decal_specs(specs)?;
        self.decals.set(parsed);
        self.dirty.bars = true;
        self.dirty.fills = true;
        Ok(())
    }

    /// Stages the decals of the bars / fills about to upload (`bars` / `fills` dirty).
    pub(crate) fn stage_decals(&mut self, bars: bool, fills: bool) {
        if bars {
            let ids: Vec<usize> = match &self.kind {
                super::ChartKind::Bar(b) if self.decals.is_on() => b.decal_ids(),
                _ => Vec::new(),
            };
            self.decals.stage_bars(self.bars.len(), &ids);
        }
        if fills {
            self.decals.stage_fills(self.fills.len());
        }
    }
}

/// `staged` when it lines up with the `uploaded` marks (animation frames of another shape
/// draw without decals).
pub(crate) fn aligned(staged: &[ChartDecalRaw], uploaded: usize) -> &[ChartDecalRaw] {
    if staged.len() == uploaded {
        staged
    } else {
        &[]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::camera::OrbitCamera;
    use crate::chart::*;
    use crate::scene::SceneWorld;
    use glam::Vec3;

    const STRIPES: [f32; 8] = [5.0, 2.0, 8.0, 0.785, -1.0, 0.0, 0.0, 0.5];
    const DOTS: [f32; 8] = [2.0, 3.0, 10.0, 0.0, 1.0, 0.0, 0.0, 1.0];

    fn specs(list: &[[f32; 8]]) -> Vec<f32> {
        list.iter().flatten().copied().collect()
    }

    fn flat_camera() -> OrbitCamera {
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        cam
    }

    fn view(cam: &OrbitCamera) -> ChartView<'_> {
        ChartView {
            camera: cam,
            viewport_px: (1600, 900),
            pixel_ratio: 1.0,
        }
    }

    #[test]
    fn specs_are_validated() {
        assert_eq!(parse_decal_specs(&[]).unwrap(), vec![]);
        let ok = parse_decal_specs(&specs(&[STRIPES, [0.0; 8], DOTS])).unwrap();
        assert_eq!(ok.len(), 3);
        assert_eq!(ok[0].pattern, [5.0, 2.0, 8.0, 0.785]);
        assert_eq!(ok[0].color[0], -1.0, "auto contrast");
        assert_eq!(ok[1], ChartDecalRaw::default(), "symbol 0 = none");
        assert_eq!(ok[2].color, [1.0, 0.0, 0.0, 1.0]);
        let bad = |s: [f32; 8]| parse_decal_specs(&s).is_err();
        assert!(parse_decal_specs(&[1.0, 2.0]).is_err(), "stride");
        assert!(
            bad([7.0, 2.0, 8.0, 0.0, -1.0, 0.0, 0.0, 0.5]),
            "unknown symbol"
        );
        assert!(
            bad([1.5, 2.0, 8.0, 0.0, -1.0, 0.0, 0.0, 0.5]),
            "fractional symbol"
        );
        assert!(bad([1.0, 0.0, 8.0, 0.0, -1.0, 0.0, 0.0, 0.5]), "size");
        assert!(bad([1.0, 2.0, 0.5, 0.0, -1.0, 0.0, 0.0, 0.5]), "spacing");
        assert!(
            bad([1.0, 2.0, 8.0, f32::NAN, -1.0, 0.0, 0.0, 0.5]),
            "rotation"
        );
        assert!(bad([1.0, 2.0, 8.0, 0.0, 2.0, 0.0, 0.0, 0.5]), "color");
        assert!(bad([1.0, 2.0, 8.0, 0.0, -1.0, 0.0, 0.0, 1.5]), "opacity");
    }

    #[test]
    fn auto_contrast_follows_the_mark_luminance() {
        let d = parse_decal_specs(&STRIPES).unwrap()[0];
        assert_eq!(decal_paint(&d, [0.95, 0.9, 0.3, 1.0]), [0.0, 0.0, 0.0, 0.5]);
        assert_eq!(decal_paint(&d, [0.1, 0.2, 0.5, 0.8]), [1.0, 1.0, 1.0, 0.4]);
        let red = parse_decal_specs(&DOTS).unwrap()[0];
        assert_eq!(
            decal_paint(&red, [0.1, 0.2, 0.5, 0.5]),
            [1.0, 0.0, 0.0, 0.5]
        );
    }

    #[test]
    fn staged_decals_line_up_with_bars_and_fill_runs() {
        let mut d = Decals::default();
        d.stage_bars(3, &[0, 1]);
        assert!(d.bars().is_empty(), "off: nothing staged");
        d.set(parse_decal_specs(&specs(&[STRIPES, [0.0; 8], DOTS])).unwrap());
        // One track first, then bars 2 / 0 / 1
        d.stage_bars(4, &[2, 0, 1]);
        let sym: Vec<u32> = d.bars().iter().map(symbol_of).collect();
        assert_eq!(sym, vec![0, 2, 5, 0]);
        d.fill_runs = vec![
            DecalRun {
                start: 0,
                end: 3,
                key: 1,
            },
            DecalRun {
                start: 3,
                end: 9,
                key: 0,
            },
        ];
        d.stage_fills(12);
        let sym: Vec<u32> = d.fills().iter().map(symbol_of).collect();
        assert_eq!(sym, [0, 0, 0, 5, 5, 5, 5, 5, 5, 0, 0, 0]);
        // Only undecorated marks: nothing staged
        d.fill_runs = vec![DecalRun {
            start: 0,
            end: 3,
            key: 1,
        }];
        d.stage_fills(3);
        assert!(d.fills().is_empty());
        d.set(Vec::new());
        d.stage_bars(4, &[2, 0, 1]);
        assert!(d.bars().is_empty());
    }

    fn bar_chart(cam: &mut OrbitCamera) -> ChartState {
        let mut scene = SceneWorld::new();
        let layout = BarLayout {
            width: 160.0,
            max_height: 80.0,
            bar_width: 0.0,
            corner_radius_px: 4.0,
            view: ChartViewMode::Flat,
        };
        let series = BarSeriesLayout {
            series_count: 2,
            mode: BarMode::Stacked,
            ..Default::default()
        };
        let chart = ChartState::new_bar_series(
            vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0],
            vec![[0.2, 0.4, 0.8, 1.0], [0.9, 0.8, 0.2, 1.0]],
            layout,
            series,
            &mut scene,
        );
        chart.frame_camera(cam, (1600.0, 900.0));
        chart
    }

    #[test]
    fn bar_decals_upload_with_the_bars_and_clear_when_off() {
        let mut cam = flat_camera();
        let mut chart = bar_chart(&mut cam);
        {
            let layers = chart.prepare_layers(&view(&cam));
            assert_eq!(
                layers.bar_decals.map(<[_]>::len),
                Some(0),
                "off: an empty decal layer clears stale decals"
            );
        }
        // Series 0 striped, series 1 (ids 3..6) dotted
        let mut by_id = vec![STRIPES; 3];
        by_id.extend([DOTS; 3]);
        chart.set_decals(&specs(&by_id)).unwrap();
        let layers = chart.prepare_layers(&view(&cam));
        let (bars, decals) = (layers.bars.unwrap(), layers.bar_decals.unwrap());
        assert_eq!(bars.len(), 6);
        assert_eq!(decals.len(), 6);
        let sym: Vec<u32> = decals.iter().map(symbol_of).collect();
        assert_eq!(sym, [5, 5, 5, 2, 2, 2]);
        // Invalid specs keep the current decals
        assert!(chart.set_decals(&[9.0; 8]).is_err());
        assert_eq!(chart.decals.bars().len(), 6);
        chart.set_decals(&[]).unwrap();
        let layers = chart.prepare_layers(&view(&cam));
        assert_eq!(layers.bar_decals.map(<[_]>::len), Some(0));
    }

    /// Distinct decal keys of the staged fill vertices, in vertex order.
    fn fill_keys(chart: &ChartState) -> Vec<u32> {
        let mut keys: Vec<u32> = chart.decals.fill_runs.iter().map(|r| r.key).collect();
        keys.dedup();
        keys
    }

    fn assert_fill_decals(chart: &mut ChartState, cam: &OrbitCamera, keys: usize) {
        chart.prepare_layers(&view(cam));
        let list: Vec<[f32; 8]> = (0..keys)
            .map(|k| if k % 2 == 0 { STRIPES } else { DOTS })
            .collect();
        chart.set_decals(&specs(&list)).unwrap();
        let layers = chart.prepare_layers(&view(cam));
        let (fills, decals) = (layers.fills.unwrap(), layers.fill_decals.unwrap());
        assert!(!fills.is_empty());
        assert_eq!(decals.len(), fills.len(), "one decal per fill vertex");
        for run in &chart.decals.fill_runs {
            let want = if run.key % 2 == 0 { 5 } else { 2 };
            assert!(chart.decals.fills()[run.start as usize..run.end as usize]
                .iter()
                .all(|d| symbol_of(d) == want));
        }
    }

    #[test]
    fn pie_slices_record_their_color_group() {
        let mut cam = flat_camera();
        let mut chart =
            ChartState::new_pie(&[3.0, 2.0, 1.0], PieOptions::default(), PieStyle::default());
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        assert_fill_decals(&mut chart, &cam, 3);
        assert_eq!(fill_keys(&chart), [0, 1, 2]);
    }

    #[test]
    fn funnel_stages_record_their_index() {
        let mut cam = flat_camera();
        let mut chart = ChartState::new_funnel(
            &[5.0, 3.0, 1.0],
            &[[0.2, 0.5, 0.9, 1.0]],
            FunnelOptions::default(),
        );
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        assert_fill_decals(&mut chart, &cam, 3);
        assert_eq!(fill_keys(&chart), [0, 1, 2]);
    }

    #[test]
    fn area_series_record_their_index() {
        let mut cam = flat_camera();
        let series = (0..2)
            .map(|s| LineSeries {
                values: (0..20).map(|i| (i + s * 3) as f32).collect(),
                x: None,
                color: [0.2, 0.4, 0.8, 1.0],
                width_px: 2.0,
            })
            .collect();
        let layout = LineLayout {
            width: 160.0,
            height: 80.0,
            view: ChartViewMode::Flat,
            x_kind: LineXKind::Numeric,
        };
        let mut chart = ChartState::new_area(series, layout, AreaMode::Stacked, 0.6);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        assert_fill_decals(&mut chart, &cam, 2);
        assert_eq!(fill_keys(&chart), [0, 1]);
    }

    fn tree() -> crate::chart::Tree {
        crate::chart::Tree::build(&[-1, 0, 0, 1, 1], &[0.0, 0.0, 4.0, 2.0, 3.0]).unwrap()
    }

    #[test]
    fn treemap_and_sunburst_cells_record_their_node() {
        let mut cam = flat_camera();
        let mut chart =
            ChartState::new_treemap(tree(), TreemapOptions::default(), HierarchyStyle::default());
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        assert_fill_decals(&mut chart, &cam, 5);
        let mut keys = fill_keys(&chart);
        keys.sort();
        assert_eq!(keys, [2, 3, 4], "leaf cells");
        let mut chart = ChartState::new_sunburst(
            tree(),
            SunburstOptions::default(),
            HierarchyStyle::default(),
        );
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        assert_fill_decals(&mut chart, &cam, 5);
        let mut keys = fill_keys(&chart);
        keys.sort();
        assert_eq!(keys, [1, 2, 3, 4], "every arc, not the center disk");
    }

    #[test]
    fn svg_export_writes_matching_patterns() {
        let mut cam = flat_camera();
        let mut chart = bar_chart(&mut cam);
        chart.prepare_layers(&view(&cam));
        let plain = chart.export_svg(&view(&cam), 0, "b").markup;
        assert!(!plain.contains("<pattern"));
        let mut by_id = vec![STRIPES; 3];
        by_id.extend([DOTS; 3]);
        chart.set_decals(&specs(&by_id)).unwrap();
        chart.prepare_layers(&view(&cam));
        let svg = chart.export_svg(&view(&cam), 0, "b").markup;
        // Stripes on the blue series (auto: white), red dots on the yellow one
        assert_eq!(svg.matches("<pattern ").count(), 2, "{svg}");
        assert!(svg.contains("patternUnits=\"userSpaceOnUse\""));
        assert!(svg.contains("patternTransform=\"rotate(44.98)\""), "{svg}");
        assert!(svg.contains("fill=\"url(#b-decal-0)\""));
        assert!(svg.contains("fill=\"url(#b-decal-1)\""));
        assert_eq!(
            svg.matches("url(#b-decal-").count(),
            6,
            "one overlay path per bar"
        );
        // The pie decorates its slices the same way
        let mut chart =
            ChartState::new_pie(&[3.0, 2.0], PieOptions::default(), PieStyle::default());
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        chart.set_decals(&specs(&[DOTS, [0.0; 8]])).unwrap();
        chart.prepare_layers(&view(&cam));
        let svg = chart.export_svg(&view(&cam), 0, "p").markup;
        assert_eq!(svg.matches("<pattern ").count(), 1);
        assert!(svg.contains("<circle"), "{svg}");
        assert!(svg.contains("fill=\"url(#p-decal-0)\""));
    }
}
