//! WASM bindings of the chord diagram (kept apart from `lib.rs`; same `WasmCharturboEngine`).
//! Colors go through `set_chart_hierarchy_style`; hover / labels / layout through the hierarchy
//! getters (`chart_hierarchy_labels`, `chart_hierarchy_layout`, `chart_hover_hierarchy_item`).

use crate::chart::{
    ChartState, ChordOptions, ChordRibbonColor, ChordSort, ChordSorts, HierarchyStyle,
};
use crate::WasmCharturboEngine;
use wasm_bindgen::prelude::*;

/// Option `at` of a flat array (missing / NaN = `None`).
fn opt(p: &[f64], at: usize) -> Option<f64> {
    p.get(at).copied().filter(|v| v.is_finite())
}

fn opt_u8(p: &[f64], at: usize) -> u8 {
    opt(p, at).map_or(0, |v| v.clamp(0.0, 255.0) as u8)
}

fn opt_flag(p: &[f64], at: usize, d: bool) -> bool {
    opt(p, at).map_or(d, |v| v > 0.5)
}

#[wasm_bindgen]
impl WasmCharturboEngine {
    /// Renders a chord diagram of a row-major `n x n` flow matrix (`n^2` values, finite, >= 0,
    /// not all zero; the scene is kept on error). `options`: `[pad_angle_rad, start_angle_rad
    /// (compass), clockwise (0 / 1), sort_groups, sort_subgroups, sort_chords (0 none,
    /// 1 ascending, 2 descending), directed (0 / 1), ribbon_color (0 source, 1 target,
    /// 2 gradient, 3 neutral), ribbon_opacity, arc_width_px, labels (0 / 1), label_rotate (0 / 1),
    /// label_room_px, label_line_px]`. Returns the group count.
    pub fn set_chord_chart(&mut self, matrix: &[f64], options: &[f64]) -> Result<usize, JsValue> {
        let n = (matrix.len() as f64).sqrt().round() as usize;
        let d = ChordOptions::default();
        let o = |at: usize| opt(options, at);
        let opts = ChordOptions {
            pad_angle: o(0).unwrap_or(d.pad_angle),
            start_angle: o(1).map_or(d.start_angle, |v| v as f32),
            clockwise: opt_flag(options, 2, d.clockwise),
            sorts: ChordSorts {
                groups: ChordSort::from_u8(opt_u8(options, 3)),
                subgroups: ChordSort::from_u8(opt_u8(options, 4)),
                chords: ChordSort::from_u8(opt_u8(options, 5)),
            },
            directed: opt_flag(options, 6, d.directed),
            ribbon_color: ChordRibbonColor::from_u8(opt_u8(options, 7)),
            ribbon_opacity: o(8).map_or(d.ribbon_opacity, |v| v as f32),
            arc_width_px: o(9).map_or(d.arc_width_px, |v| v as f32),
            labels: opt_flag(options, 10, d.labels),
            label_rotate: opt_flag(options, 11, d.label_rotate),
            label_room_px: o(12).map_or(d.label_room_px, |v| v as f32),
            label_line_px: o(13).map_or(d.label_line_px, |v| v as f32),
        };
        let chart = ChartState::new_chord(matrix, n, opts, HierarchyStyle::default())
            .map_err(|e| JsValue::from_str(&e))?;
        self.inner.set_chart_state(chart);
        Ok(n)
    }

    /// Chord groups, 4 each by input index: `[start, end, value, visible (0 / 1)]` (layout
    /// angles: radians from the start angle in the drawing direction).
    pub fn chart_chord_groups(&self) -> Vec<f64> {
        let Some((layout, shown)) = self.inner.chart().and_then(|c| c.chord_layout()) else {
            return Vec::new();
        };
        layout
            .groups
            .iter()
            .flat_map(|g| {
                [
                    g.start,
                    g.end,
                    g.value,
                    if shown[g.index as usize] { 1.0 } else { 0.0 },
                ]
            })
            .collect()
    }

    /// Chords in draw order, 8 each: `[source, start, end, value, target, start, end, value]`
    /// (ribbon index = `source * n + target`).
    pub fn chart_chord_chords(&self) -> Vec<f64> {
        let Some((layout, _)) = self.inner.chart().and_then(|c| c.chord_layout()) else {
            return Vec::new();
        };
        layout
            .chords
            .iter()
            .flat_map(|c| {
                let (s, t) = (c.source, c.target);
                [
                    s.index as f64,
                    s.start,
                    s.end,
                    s.value,
                    t.index as f64,
                    t.start,
                    t.end,
                    t.value,
                ]
            })
            .collect()
    }
}
